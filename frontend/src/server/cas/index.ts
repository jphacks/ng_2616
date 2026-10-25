import 'server-only';
import { serverEnv } from '@/server/env';
import { fail, GatewayError, ok, readJson } from '@/server/gateway/http';
import { authenticate } from '@/server/supabase';

/**
 * CAS on the Azure VM (ADR 0009). The browser hands this route the same validated IR payload it used
 * to give its Pyodide worker; cas-worker runs packages/cas-core on it with the same 5 s budget.
 * The key stays on this server; the browser never learns the worker's address.
 */

// the worker's 5 s check plus its 3 s queue wait, and the trip to the VM
const DEADLINE_MS = 12_000;
const PASSED_THROUGH = new Set(['CAS_BUSY', 'CAS_TIMEOUT', 'CAS_STARTING', 'CAS_ERROR', 'PAYLOAD_TOO_LARGE']);

export function casConfigured(): boolean {
  return !!serverEnv().CAS_WORKER_URL;
}

async function callWorker(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const env = serverEnv();
  if (!env.CAS_WORKER_URL) throw new GatewayError(503, 'CAS_UNAVAILABLE', 'configure CAS_WORKER_URL');
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (env.CAS_WORKER_KEY) headers['x-cas-key'] = env.CAS_WORKER_KEY;
  try {
    return await fetch(env.CAS_WORKER_URL.replace(/\/$/, '') + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw new GatewayError(504, 'CAS_TIMEOUT', 'the checker did not answer in time');
    if (signal.aborted) throw new GatewayError(499, 'CANCELLED', 'check cancelled');
    throw new GatewayError(503, 'CAS_UNAVAILABLE', 'the checker is not reachable', true);
  }
}

async function relay(requestId: string, res: Response): Promise<Response> {
  const parsed = (await res.json().catch(() => null)) as { ok: boolean; data?: unknown; error?: { code?: string; retryable?: boolean } } | null;
  if (res.ok && parsed?.ok && parsed.data !== undefined) return ok(requestId, parsed.data);
  const code = parsed?.error?.code && PASSED_THROUGH.has(parsed.error.code) ? parsed.error.code : 'CAS_UNAVAILABLE';
  const status = res.status >= 400 && res.status < 600 && code !== 'CAS_UNAVAILABLE' ? res.status : 503;
  // a wrong key or an unconfigured worker is the administrator's to fix; the browser only sees unavailable
  if (res.status === 403 || res.status === 503) console.error('[cas] worker refused', res.status, parsed?.error?.code);
  return fail(requestId, new GatewayError(status, code, 'the check did not complete', parsed?.error?.retryable ?? true));
}

function isPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  return Array.isArray(p.lines) && !!p.target && typeof p.target === 'object' && !Array.isArray(p.target);
}

/** POST /api/v1/cas/verify: one CAS check, same payload and answer as the browser worker's. */
export async function casVerify(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const user = await authenticate(request);
    if (!user) throw new GatewayError(401, 'AUTH_REQUIRED', 'sign in required');
    const raw = await readJson(request);
    if (!isPayload(raw)) throw new GatewayError(400, 'INVALID_REQUEST', 'invalid CAS payload');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]);
    return await relay(requestId, await callWorker('POST', '/verify', raw, signal));
  } catch (e) {
    if (e instanceof GatewayError) return fail(requestId, e);
    console.error('[cas] unexpected', e instanceof Error ? e.message : e);
    return fail(requestId, new GatewayError(502, 'CAS_UNAVAILABLE', 'unexpected server error', true));
  }
}

/** GET /api/v1/cas/health: whether the checker is ready, and the versions every Proof records. */
export async function casHealth(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const user = await authenticate(request);
    if (!user) throw new GatewayError(401, 'AUTH_REQUIRED', 'sign in required');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]);
    return await relay(requestId, await callWorker('GET', '/health', undefined, signal));
  } catch (e) {
    if (e instanceof GatewayError) return fail(requestId, e);
    return fail(requestId, new GatewayError(502, 'CAS_UNAVAILABLE', 'unexpected server error', true));
  }
}
