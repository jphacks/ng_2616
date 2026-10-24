import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeanCheckInput, LeanStepWire } from '@mn/contracts';
import type { JsonRequest, LlmProvider } from '../../../src/server/ai/direct/providers/types';
import { LeanService } from '../../../src/server/lean/service';
import { LeanUnavailable, type LeanWorker, type WorkerCheck } from '../../../src/server/lean/worker';
import { segs } from '../suggest/fixtures';

// run with: npx tsx --test --conditions=react-server <file>

const env = { LLM_MODEL_LEAN: 'test-model', LLM_THINKING_LEAN: 'high' as const };
const ctx = () => ({ userId: 'u', signal: new AbortController().signal });
const HASH = `sha256:${'1'.repeat(64)}` as const;
const OTHER = `sha256:${'2'.repeat(64)}` as const;
const THEOREM = '∀ n : ℕ, ∑ k ∈ Finset.range n, (2 * k + 1) = n ^ 2';

function fakeLlm(replies: LeanStepWire[], opts: { mock?: boolean } = {}) {
  const calls: JsonRequest[] = [];
  const llm: LlmProvider = {
    name: 'fake',
    mock: opts.mock ?? false,
    async generateJson(req) {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (!r) throw new Error('no reply');
      return r;
    },
  };
  return { llm, calls };
}

function fakeWorker(answer: (statement: string, steps: string[]) => Partial<WorkerCheck>, opts: { ready?: boolean; down?: boolean } = {}) {
  const checks: { statement: string; steps: string[] }[] = [];
  const worker: LeanWorker = {
    async check(statement, steps) {
      checks.push({ statement, steps });
      return { state: 'proved', steps: steps.map((_, index) => ({ index, state: 'ok', messages: [] })), elapsed_ms: 1, toolchain: 'v4.35.0', mathlib: 'v4.35.0', ...answer(statement, steps) };
    },
    async health() {
      if (opts.down) throw new LeanUnavailable('Lean worker is not reachable');
      return { lean_ready: opts.ready ?? true, toolchain: 'v4.35.0', mathlib: 'v4.35.0' };
    },
  };
  return { worker, checks };
}

const input = (over: Partial<LeanCheckInput> = {}): LeanCheckInput => ({
  theorem: { statement: THEOREM, given_hash: HASH, source: 'template' },
  given: [{ id: 'G1', segments: segs('Prove for every natural number $n$ that the odd numbers sum to a square.') }],
  given_hash: HASH,
  lines: [
    { id: 'L1', route: 'lean', segments: segs('Let $n$ be natural.'), tactic: 'intro n' },
    { id: 'L2', route: 'lean', segments: segs('By induction on $n$.') },
  ],
  target_line_id: 'L2',
  ui_lang: 'en',
  ...over,
});

const wire = (steps: LeanStepWire['steps'], over: Partial<LeanStepWire> = {}): LeanStepWire => ({ scope: 'theorem', statement: '', steps, hint: 'Try induction.', ...over });

describe('LeanService.check (ADR 0007)', () => {
  it('without a worker or with the mock model it answers unavailable and calls nothing', async () => {
    const { llm, calls } = fakeLlm([wire([])]);
    assert.equal((await new LeanService(llm, null, env).check(input(), ctx())).state, 'unavailable');
    const mock = fakeLlm([wire([])], { mock: true });
    const { worker, checks } = fakeWorker(() => ({}));
    const r = await new LeanService(mock.llm, worker, env).check(input(), ctx());
    assert.deepEqual([r.state, r.message, mock.calls.length, checks.length], ['unavailable', 'MOCK_PROVIDER', 0, 0]);
    assert.equal(calls.length, 0);
  });

  it('asks no model while the worker is down or still importing Mathlib', async () => {
    for (const opts of [{ down: true }, { ready: false }]) {
      const { llm, calls } = fakeLlm([wire([])]);
      const { worker } = fakeWorker(() => ({}), opts);
      const r = await new LeanService(llm, worker, env).check(input(), ctx());
      assert.equal(r.state, 'unavailable');
      assert.equal(calls.length, 0);
    }
  });

  it('keeps earlier tactics, translates only the missing ones and runs the template theorem as given', async () => {
    const { llm, calls } = fakeLlm([wire([{ line_id: 'L2', tactic: 'induction n' }], { statement: 'IGNORED' })]);
    const { worker, checks } = fakeWorker(() => ({ state: 'incomplete', goals: 'case succ …' }));
    const r = await new LeanService(llm, worker, env).check(input(), ctx());
    assert.equal(calls.length, 1);
    assert.deepEqual(checks, [{ statement: THEOREM, steps: ['intro n', 'induction n'] }]);
    assert.deepEqual(r.steps.map((s) => [s.line_id, s.tactic, s.state]), [['L1', 'intro n', 'ok'], ['L2', 'induction n', 'ok']]);
    assert.equal(r.state, 'incomplete');
    assert.equal(r.theorem?.source, 'template');
    // the model sees which line already has Lean and which is the target
    const prompt = (calls[0]!.parts[0] as { text: string }).text;
    assert.match(prompt, /\[L1\][^\n]*\n {2}tactic: \n {4}intro n/);
    assert.match(prompt, /\[L2\][^\n]*← target\n {2}tactic: \(none\)/);
  });

  it('repairs a refused translation with Lean’s own message, up to three model calls', async () => {
    const { llm, calls } = fakeLlm([wire([{ line_id: 'L2', tactic: 'inductoin n' }]), wire([{ line_id: 'L2', tactic: 'induction n' }])]);
    const { worker, checks } = fakeWorker((_s, steps) =>
      steps[1] === 'inductoin n' ? { state: 'failed', steps: [{ index: 0, state: 'ok', messages: [] }, { index: 1, state: 'failed', messages: ["unknown tactic 'inductoin'"] }] } : { state: 'incomplete' },
    );
    const r = await new LeanService(llm, worker, env).check(input(), ctx());
    assert.equal(calls.length, 2);
    assert.equal(checks.length, 2);
    assert.equal(r.state, 'incomplete');
    assert.equal(r.attempts, 2);
    const second = (calls[1]!.parts[0] as { text: string }).text;
    assert.match(second, /Lean feedback on your earlier attempts:[\s\S]*inductoin n[\s\S]*unknown tactic 'inductoin'/);
  });

  it('a step that still fails after three calls is reported failed with the model’s hint', async () => {
    const { llm, calls } = fakeLlm([wire([{ line_id: 'L2', tactic: 'linarith' }], { hint: 'Say which variable.' })]);
    const { worker } = fakeWorker(() => ({ state: 'failed', steps: [{ index: 0, state: 'ok', messages: [] }, { index: 1, state: 'failed', messages: ['linarith failed'] }] }));
    const r = await new LeanService(llm, worker, env).check(input(), ctx());
    assert.equal(calls.length, 3);
    assert.deepEqual([r.state, r.steps[1]!.state, r.steps[1]!.message, r.hint], ['failed', 'failed', 'linarith failed', 'Say which variable.']);
  });

  it('a failure on a line checked before is not the model’s to repair: no retry', async () => {
    const { llm, calls } = fakeLlm([wire([{ line_id: 'L2', tactic: 'induction n' }])]);
    const { worker } = fakeWorker(() => ({ state: 'failed', steps: [{ index: 0, state: 'failed', messages: ['no'] }, { index: 1, state: 'unchecked', messages: [] }] }));
    const r = await new LeanService(llm, worker, env).check(input(), ctx());
    assert.equal(calls.length, 1);
    assert.equal(r.state, 'failed');
  });

  it('formalizes the theorem when none is known (or it was made from other given lines) and returns it', async () => {
    const { llm, calls } = fakeLlm([wire([{ line_id: 'L2', tactic: 'induction n' }], { statement: THEOREM })]);
    const { worker, checks } = fakeWorker(() => ({ state: 'incomplete' }));
    const stale = { statement: 'True', given_hash: OTHER, source: 'ai' as const };
    const r = await new LeanService(llm, worker, env).check(input({ theorem: stale }), ctx());
    assert.equal(checks[0]!.statement, THEOREM);
    assert.deepEqual(r.theorem, { statement: THEOREM, given_hash: HASH, source: 'ai' });
    assert.match((calls[0]!.parts[0] as { text: string }).text, /Lean theorem: \(none yet: write it\)/);
  });

  it('a statement Lean cannot read is retried when the model wrote it, never when the template did', async () => {
    const invalid = () => ({ state: 'invalid' as const, steps: [], statement_error: 'unknown identifier' });
    const fromModel = fakeLlm([wire([{ line_id: 'L2', tactic: 'induction n' }], { statement: 'bad' })]);
    await new LeanService(fromModel.llm, fakeWorker(invalid).worker, env).check(input({ theorem: undefined }), ctx());
    assert.equal(fromModel.calls.length, 3);
    const fromTemplate = fakeLlm([wire([{ line_id: 'L2', tactic: 'induction n' }])]);
    const r = await new LeanService(fromTemplate.llm, fakeWorker(invalid).worker, env).check(input(), ctx());
    assert.equal(fromTemplate.calls.length, 1);
    assert.equal(r.state, 'invalid');
  });

  it('scope "line": with nothing stated to prove, the target alone proves its own claim', async () => {
    const { llm } = fakeLlm([wire([{ line_id: 'L2', tactic: 'intro x hx\nnlinarith' }], { scope: 'line', statement: '∀ x : ℝ, x > 1 → x ^ 2 > 1' })]);
    const { worker, checks } = fakeWorker(() => ({}));
    const r = await new LeanService(llm, worker, env).check(input({ theorem: undefined, given: [] }), ctx());
    assert.deepEqual(checks, [{ statement: '∀ x : ℝ, x > 1 → x ^ 2 > 1', steps: ['intro x hx\nnlinarith'] }]);
    assert.deepEqual([r.scope, r.state, r.theorem, r.steps.map((s) => s.line_id)], ['line', 'proved', undefined, ['L2']]);
  });
});
