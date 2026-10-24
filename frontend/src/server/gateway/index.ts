import 'server-only';
import {
  CapabilitiesSchema,
  FeatureSchema,
  LeanCheckInputSchema,
  MetaSchema,
  OcrPageInputSchema,
  RecognizeInputSchema,
  SCHEMA_VERSION,
  SuggestInputSchema,
  hashOf,
  type Capabilities,
  type Feature,
  type Job,
  type Meta,
} from '@mn/contracts';
import { z } from 'zod';
import { AiError } from '@/server/ai/errors';
import { getAiService } from '@/server/ai/service';
import { getLeanService, leanConfigured } from '@/server/lean';
import { serverEnv } from '@/server/env';
import { authenticate, type AuthedUser } from '@/server/supabase';
import { fail, GatewayError, ok, readJson } from './http';
import { lookup, remember } from './idempotency';
import { withLimits } from './limits';

type JobRoute = {
  kind: 'recognize' | 'suggest' | 'resources_page' | 'lean_check';
  input: z.ZodType;
  deadlineMs: number;
  run: (input: never, user: AuthedUser, signal: AbortSignal) => Promise<unknown>;
};

const JOB_ROUTES: Record<string, JobRoute> = {
  recognize: {
    kind: 'recognize',
    input: RecognizeInputSchema,
    deadlineMs: 45_000,
    run: (input, user, signal) => getAiService().recognize(input, { userId: user.id, signal }),
  },
  suggest: {
    kind: 'suggest',
    input: SuggestInputSchema,
    deadlineMs: 60_000,
    run: (input, user, signal) => getAiService().suggest(input, { userId: user.id, signal }),
  },
  'resources/page': {
    kind: 'resources_page',
    input: OcrPageInputSchema,
    deadlineMs: 45_000,
    run: (input, user, signal) => getAiService().ocrPage(input, { userId: user.id, signal }),
  },
  // ADR 0008: up to three translations plus their Lean checks. Longer than spec §14.4's 90 s:
  // one translation of a hard step took 110 s in testing (thinking tokens), see LeanService
  'lean/check': {
    kind: 'lean_check',
    input: LeanCheckInputSchema,
    deadlineMs: 300_000,
    run: (input, user, signal) => getLeanService().check(input, { userId: user.id, signal }),
  },
};

function enabledFeatures(): Record<Feature, boolean> {
  const on = new Set(serverEnv().NEXT_PUBLIC_ENABLED_FEATURES.split(',').map((s) => s.trim()).filter(Boolean));
  return Object.fromEntries(FeatureSchema.options.map((f) => [f, on.has(f)])) as Record<Feature, boolean>;
}

function capabilities(): Capabilities {
  const env = serverEnv();
  const status = getAiService().status();
  return CapabilitiesSchema.parse({
    schema_version: SCHEMA_VERSION,
    build_id: env.buildId,
    features: enabledFeatures(),
    cas_runtime: 'pyodide',
    ai_execution: env.AI_EXECUTION,
    llm: status,
    lean: { available: leanConfigured() },
  });
}

export async function dispatch(request: Request, method: string, path: string[]): Promise<Response> {
  const requestId = crypto.randomUUID();
  const route = path.join('/');
  try {
    if (method === 'GET' && route === 'health') {
      const status = getAiService().status();
      return ok(requestId, { status: 'ok', build_id: serverEnv().buildId, llm_configured: status.configured, lean_ready: leanConfigured() });
    }
    const user = await authenticate(request);
    if (!user) throw new GatewayError(401, 'AUTH_REQUIRED', 'sign in required');

    if (method === 'GET' && route === 'capabilities') return ok(requestId, capabilities());
    if (path[0] === 'jobs' && path.length === 2 && (method === 'GET' || method === 'DELETE')) {
      // direct mode completes jobs inline; there is nothing to poll or cancel
      throw new GatewayError(404, 'NOT_FOUND', 'job not found');
    }
    const jobRoute = method === 'POST' ? JOB_ROUTES[route] : undefined;
    if (!jobRoute) throw new GatewayError(404, 'NOT_FOUND', `no route ${method} /api/v1/${route}`);
    return await runJob(request, requestId, user, jobRoute);
  } catch (e) {
    if (e instanceof GatewayError) return fail(requestId, e);
    console.error('[gateway] unexpected', route, e instanceof Error ? e.message : e);
    return fail(requestId, new GatewayError(502, 'UPSTREAM_INVALID', 'unexpected server error', true));
  }
}

async function runJob(request: Request, requestId: string, user: AuthedUser, route: JobRoute): Promise<Response> {
  const key = request.headers.get('idempotency-key') ?? '';
  if (!z.uuid().safeParse(key).success) throw new GatewayError(400, 'INVALID_REQUEST', 'Idempotency-Key header must be a UUID');
  const body = await readJson(request);
  const envelope = z.object({ meta: MetaSchema, input: route.input }).safeParse(body);
  if (!envelope.success) {
    throw new GatewayError(400, 'INVALID_REQUEST', envelope.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const { meta, input } = envelope.data as { meta: Meta; input: unknown };
  // request_id is transport identity, excluded from the input digest (spec §7.2)
  const digest = hashOf(input);
  const idemKey = `${user.id}:${route.kind}:${key}`;
  const seen = lookup(idemKey, digest);
  if (seen.kind === 'conflict') throw new GatewayError(409, 'IDEMPOTENCY_CONFLICT', 'same Idempotency-Key with different input');
  if (seen.kind === 'hit') return ok(requestId, { job: await seen.job }, 202);

  const job = execute(route, input, meta, user, request.signal);
  remember(idemKey, digest, job);
  return ok(requestId, { job: await job }, 202);
}

async function execute(route: JobRoute, input: unknown, meta: Meta, user: AuthedUser, clientSignal: AbortSignal): Promise<Job> {
  const created = new Date();
  const base = {
    id: crypto.randomUUID(),
    kind: route.kind,
    meta,
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + 60 * 60 * 1000).toISOString(),
  };
  const deadline = AbortSignal.timeout(route.deadlineMs);
  const signal = AbortSignal.any([deadline, clientSignal]);
  try {
    const result = await withLimits(user.id, route.kind, () => route.run(input as never, user, signal));
    return { ...base, state: 'succeeded', phase: 'done', result };
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    if (clientSignal.aborted) return { ...base, state: 'cancelled', phase: 'done', error: { code: 'CANCELLED', message: 'client went away', retryable: true } };
    if (deadline.aborted) return { ...base, state: 'failed', phase: 'done', error: { code: 'UPSTREAM_TIMEOUT', message: 'deadline exceeded', retryable: true } };
    if (e instanceof AiError) return { ...base, state: 'failed', phase: 'done', error: { code: e.code, message: e.message, retryable: e.retryable } };
    console.error('[gateway] job failed', route.kind, e instanceof Error ? e.message : e);
    return { ...base, state: 'failed', phase: 'done', error: { code: 'UPSTREAM_INVALID', message: 'provider error', retryable: true } };
  }
}
