import 'server-only';
import {
  LEAN_STEP_JSON_SCHEMA,
  LeanStepWireSchema,
  type LeanCheckInput,
  type LeanCheckResult,
  type LeanCheckStep,
  type LeanStepWire,
  type LeanTheorem,
} from '@mn/contracts';
import type { ServerEnv } from '@/server/env';
import { AiError } from '../ai/errors';
import type { CallCtx } from '../ai/service';
import type { LlmProvider } from '../ai/direct/providers/types';
import { LEAN_SYSTEM, leanParts, type LeanFeedback } from './prompts';
import { LeanUnavailable, type LeanWorker, type WorkerCheck } from './worker';

/** Model calls per check, repairs included (spec §14.4: at most three AI-LP calls). */
export const LEAN_ATTEMPTS = 3;

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : undefined);

/**
 * One Lean check of a notebook line (ADR 0008): the model translates the lines that have no Lean
 * yet, lean-worker runs the whole proof so far, and a refused translation is repaired with Lean's
 * own messages. Earlier lines keep the tactics they were checked with, so a proof never shifts
 * under the student; only the lines translated in this call are retried.
 */
export class LeanService {
  constructor(
    private llm: LlmProvider,
    private worker: LeanWorker | null,
    private env: Pick<ServerEnv, 'LLM_MODEL_LEAN' | 'LLM_THINKING_LEAN'>,
  ) {}

  async check(input: LeanCheckInput, ctx: CallCtx): Promise<LeanCheckResult> {
    const base = { steps: [], attempts: 0, mock: this.llm.mock, scope: 'theorem' as const };
    if (!this.worker) return { ...base, state: 'unavailable', message: 'LEAN_NOT_CONFIGURED' };
    if (this.llm.mock) return { ...base, state: 'unavailable', message: 'MOCK_PROVIDER' };
    // no model call while Lean cannot answer anyway (worker down, or still importing Mathlib)
    try {
      const health = await this.worker.health(ctx.signal);
      if (!health.lean_ready) return { ...base, state: 'unavailable', message: health.error ? clip(health.error, 500) : 'LEAN_STARTING' };
    } catch (e) {
      if (e instanceof LeanUnavailable) return { ...base, state: 'unavailable', message: clip(e.message, 500) };
      throw e;
    }
    // a theorem formalized from other given lines no longer states this problem
    const known = input.theorem && input.theorem.given_hash === input.given_hash ? input.theorem : undefined;
    const feedback: LeanFeedback[] = [];
    let last: LeanCheckResult | null = null;
    for (let attempt = 1; attempt <= LEAN_ATTEMPTS; attempt++) {
      const wire = await this.translate({ ...input, theorem: known }, feedback, ctx);
      if (!wire) {
        feedback.push({ tactics: [], lean: 'Your output did not match the JSON schema.' });
        continue;
      }
      const scope = known ? 'theorem' : wire.scope;
      const statement = known?.statement ?? wire.statement.trim();
      const fresh = new Map(wire.steps.map((s) => [s.line_id, s.tactic]));
      // scope "line": the target alone proves its own claim; earlier lines are hypotheses in the statement
      const lines = scope === 'line' ? input.lines.filter((l) => l.id === input.target_line_id) : input.lines;
      const tactics = lines.map((l) => (scope === 'theorem' && l.tactic !== undefined ? l.tactic : (fresh.get(l.id) ?? '')));
      const translated = new Set(lines.filter((l) => scope === 'line' || l.tactic === undefined).map((l) => l.id));
      if (!statement) {
        feedback.push({ tactics: [], lean: 'The statement is empty.' });
        continue;
      }
      let res: WorkerCheck;
      try {
        res = await this.worker.check(statement, tactics, ctx.signal);
      } catch (e) {
        if (e instanceof LeanUnavailable) return { ...base, state: 'unavailable', attempts: attempt, message: clip(e.message, 500) };
        throw e;
      }
      const steps: LeanCheckStep[] = lines.map((l, i) => {
        const s = res.steps.find((x) => x.index === i);
        return { line_id: l.id, tactic: tactics[i]!, state: s?.state ?? (res.rejected || res.state === 'invalid' ? 'unchecked' : 'empty'), ...(s?.messages.length ? { message: clip(s.messages.join('\n'), 2000) } : {}) };
      });
      const theorem: LeanTheorem | undefined =
        known ?? (scope === 'theorem' && res.state !== 'invalid' ? { statement, given_hash: input.given_hash, source: 'ai' } : undefined);
      last = {
        state: res.state,
        scope,
        ...(theorem ? { theorem } : {}),
        statement,
        steps,
        ...(res.goals ? { goals: clip(res.goals, 2000) } : {}),
        ...(res.statement_error ? { message: clip(res.statement_error, 2000) } : {}),
        ...(wire.hint ? { hint: clip(wire.hint, 600) } : {}),
        attempts: attempt,
        mock: false,
        versions: { toolchain: res.toolchain, mathlib: res.mathlib },
      };
      const problem = this.retryReason(res, steps, translated, !!known);
      if (!problem) return last;
      feedback.push({ tactics: steps.filter((s) => translated.has(s.line_id)).map((s) => ({ line_id: s.line_id, tactic: s.tactic })), ...(known ? {} : { statement }), lean: problem });
    }
    return last ?? { ...base, state: 'invalid', attempts: LEAN_ATTEMPTS, message: 'the model gave no usable translation' };
  }

  /** Why this attempt should be repaired, or null when its answer stands. */
  private retryReason(res: WorkerCheck, steps: LeanCheckStep[], translated: Set<string>, statementFixed: boolean): string | null {
    if (res.state === 'timeout') return 'Lean ran out of time. Use more direct tactics.';
    if (res.state === 'invalid') {
      // a template's reviewed statement is not the model's to change: report it as it is
      if (statementFixed && !res.rejected) return null;
      return clip(res.statement_error, 1500) ?? 'Lean could not read the statement.';
    }
    const failed = steps.filter((s) => s.state === 'failed' && translated.has(s.line_id));
    if (!failed.length) return null;
    return failed.map((s) => `[${s.line_id}] ${s.message ?? 'failed'}`).join('\n').slice(0, 2000);
  }

  private async translate(input: LeanCheckInput, feedback: LeanFeedback[], ctx: CallCtx): Promise<LeanStepWire | null> {
    const raw = await this.llm.generateJson({
      task: 'lean',
      model: this.env.LLM_MODEL_LEAN,
      thinking: this.env.LLM_THINKING_LEAN,
      system: LEAN_SYSTEM,
      parts: leanParts(input, feedback),
      schema: LEAN_STEP_JSON_SCHEMA,
      maxOutputTokens: 16_384,
      // measured with gemini-3.8-flash at high thinking: 5–30 s for a one-line step, up to 110 s for
      // an ε–δ estimate written as one line
      timeoutMs: 120_000,
      signal: ctx.signal,
    });
    const wire = LeanStepWireSchema.safeParse(raw);
    if (process.env.NODE_ENV === 'development') console.info('[lean]', JSON.stringify(raw).slice(0, 800));
    if (!wire.success) {
      if (feedback.length + 1 >= LEAN_ATTEMPTS) throw new AiError('SCHEMA_INVALID', 'Lean translation did not match the schema');
      return null;
    }
    return wire.data;
  }
}
