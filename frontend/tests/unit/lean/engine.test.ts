import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { leanOf, theoremOf, withTheorem, type LeanCheckInput, type LeanCheckResult, type Line, type Notebook } from '@mn/contracts';
import { givenHash, leanContextHash, leanInput, needsLean } from '../../../src/core/lean/route';
import { buildNotebook } from '../../../src/core/presets';
import { casStatus, deferred, draftFor, fakeApi, fakeCas, lineOf, rig, until, type FakeApi } from '../suggest/harness';
import { line, segs, settled } from '../suggest/fixtures';

// run with: npx tsx --test --conditions=react-server <file>

const THEOREM = '∀ n : ℕ, ∑ k ∈ Finset.range n, (2 * k + 1) = n ^ 2';

let saved: string | undefined;
before(() => {
  saved = process.env.NEXT_PUBLIC_ENABLED_FEATURES;
  process.env.NEXT_PUBLIC_ENABLED_FEATURES = 'lean';
});
after(() => {
  process.env.NEXT_PUBLIC_ENABLED_FEATURES = saved;
});

const given = settled('G1', 'Prove that for every natural number $n$ the odd numbers sum to a square.', 'none', 'PREMISE', { role: 'premise' });
const proofLine = (id: string, src: string, extensions: Line['extensions'] = { route: 'lean' }) => settled(id, src, 'none', 'TEXT_ONLY', { extensions });

/** An api whose leanCheck answers via `answer` and records every request. */
function leanApi(answer: (input: LeanCheckInput) => LeanCheckResult | Promise<LeanCheckResult>) {
  const api = fakeApi((input) => draftFor(input, 'x = 2')) as FakeApi & { leanCalls: LeanCheckInput[] };
  api.leanCalls = [];
  api.leanCheck = async (_meta, input) => {
    api.leanCalls.push(input);
    return answer(input);
  };
  return api;
}

const okResult = (input: LeanCheckInput, over: Partial<LeanCheckResult> = {}): LeanCheckResult => ({
  state: 'incomplete',
  scope: 'theorem',
  statement: THEOREM,
  steps: input.lines.map((l) => ({ line_id: l.id, tactic: l.tactic ?? `tactic for ${l.id}`, state: 'ok' })),
  goals: '⊢ …',
  attempts: 1,
  mock: false,
  versions: { toolchain: 'v4.35.0', mathlib: 'v4.35.0' },
  ...over,
});

/** The rig's notebook with the template theorem attached to its given lines. */
function withLeanTheorem(r: ReturnType<typeof rig>) {
  const nb = r.store.getState().notebook!;
  r.store.getState().set('notebook', withTheorem(nb, { statement: THEOREM, given_hash: givenHash(nb.lines), source: 'template' }));
}

describe('Lean routing (ADR 0007)', () => {
  it('a line the model routed to Lean is checked after the CAS, and keeps its verdict', async () => {
    const api = leanApi((input) => okResult(input));
    const r = rig({ lines: [given, proofLine('L1', 'Let $n$ be natural.', { route: 'lean', lean: { tactic: 'intro n' } }), line('L2', 'VERIFYING', { segments: segs('By induction on $n$.'), extensions: { route: 'lean' } }), line('D1', 'DRAFT')], api, cas: fakeCas(() => casStatus('none', { reason: 'TEXT_ONLY' })) });
    try {
      withLeanTheorem(r);
      await r.engine.verifyLine('L2');
      await until(() => !!leanOf(lineOf(r, 'L2')!)?.proof, 'Lean verdict');
      const sent = api.leanCalls[0]!;
      assert.equal(sent.target_line_id, 'L2');
      assert.deepEqual(sent.lines.map((l) => [l.id, l.tactic]), [['L1', 'intro n'], ['L2', undefined]]);
      assert.equal(sent.theorem?.statement, THEOREM);
      const lean = leanOf(lineOf(r, 'L2')!)!;
      assert.deepEqual([lean.step, lean.proof, lean.tactic], ['ok', 'incomplete', 'tactic for L2']);
      assert.equal(lean.context_hash, leanContextHash(sent));
      assert.equal(r.store.getState().leanPending.L2, undefined);
      // the same context again: no second request for L2 (L1, which never had a verdict, may get its own)
      await r.engine.recheckStale();
      assert.equal(api.leanCalls.filter((c) => c.target_line_id === 'L2').length, 1);
    } finally {
      r.dispose();
    }
  });

  it('an earlier line that had no Lean keeps the translation the check made for it', async () => {
    const api = leanApi((input) => okResult(input));
    const r = rig({ lines: [given, settled('L1', '$x = 1$', 'ok'), line('L2', 'VERIFYING', { segments: segs('Hence the claim holds for $n$.'), extensions: { route: 'lean' } }), line('D1', 'DRAFT')], api });
    try {
      withLeanTheorem(r);
      await r.engine.verifyLine('L2');
      await until(() => !!leanOf(lineOf(r, 'L2')!)?.proof, 'Lean verdict');
      assert.deepEqual(leanOf(lineOf(r, 'L1')!), { tactic: 'tactic for L1' });
      // only the line Lean was asked about shows a Lean verdict; the CAS line keeps its own badge
      assert.equal(leanOf(lineOf(r, 'L1')!)?.proof, undefined);
    } finally {
      r.dispose();
    }
  });

  it('a CAS line the CAS cannot read goes to Lean in a proof notebook, but not in an ordinary one', () => {
    const nb = (lines: Line[], theorem = false): Notebook => {
      const base = buildNotebook('blank', 'en');
      const n = { ...base, lines };
      return theorem ? withTheorem(n, { statement: THEOREM, given_hash: givenHash(lines), source: 'template' }) : n;
    };
    const unreadable = settled('L1', '$x = 1$', 'unknown', 'UNPARSED');
    assert.equal(needsLean(nb([given, unreadable], true), unreadable), true);
    assert.equal(needsLean(nb([given, unreadable]), unreadable), false);
    const filler = proofLine('L2', 'Proof for $n$:', { route: 'none' });
    assert.equal(needsLean(nb([given, filler], true), filler), false);
    assert.equal(needsLean(nb([given], true), given), false);
  });

  it('a verdict for a line that changed meanwhile is dropped', async () => {
    const held = deferred<LeanCheckResult>();
    const api = leanApi(() => held.promise);
    const r = rig({ lines: [given, line('L2', 'VERIFYING', { segments: segs('By induction on $n$.'), extensions: { route: 'lean' } }), line('D1', 'DRAFT')], api });
    try {
      withLeanTheorem(r);
      await r.engine.verifyLine('L2');
      await until(() => api.leanCalls.length === 1, 'Lean request');
      const sent = api.leanCalls[0]!;
      r.store.getState().patchLine('L2', (l) => ({ ...l, version: l.version + 1 }));
      held.resolve(okResult(sent));
      await until(() => !r.store.getState().leanPending.L2, 'request over');
      assert.equal(leanOf(lineOf(r, 'L2')!)?.proof, undefined);
    } finally {
      r.dispose();
    }
  });

  it('an unreachable Lean is shown, and asked again on the next recheck', async () => {
    let n = 0;
    const api = leanApi((input) => (n++ === 0 ? { state: 'unavailable', scope: 'theorem', steps: [], attempts: 0, mock: false, message: 'LEAN_STARTING' } : okResult(input)));
    const r = rig({ lines: [given, line('L2', 'VERIFYING', { segments: segs('By induction on $n$.'), extensions: { route: 'lean' } }), line('D1', 'DRAFT')], api });
    try {
      withLeanTheorem(r);
      await r.engine.verifyLine('L2');
      await until(() => !!leanOf(lineOf(r, 'L2')!)?.proof, 'first verdict');
      assert.equal(leanOf(lineOf(r, 'L2')!)!.proof, 'unavailable');
      assert.equal(leanOf(lineOf(r, 'L2')!)!.context_hash, undefined);
      await r.engine.recheckStale();
      await until(() => leanOf(lineOf(r, 'L2')!)?.proof === 'incomplete', 'second verdict');
      assert.equal(api.leanCalls.length, 2);
    } finally {
      r.dispose();
    }
  });

  it('a theorem the model formalized is stored on the notebook', async () => {
    const api = leanApi((input) => okResult(input, { theorem: { statement: THEOREM, given_hash: input.given_hash, source: 'ai' } }));
    const r = rig({ lines: [given, line('L2', 'VERIFYING', { segments: segs('By induction on $n$.'), extensions: { route: 'lean' } }), line('D1', 'DRAFT')], api });
    try {
      await r.engine.verifyLine('L2');
      await until(() => !!theoremOf(r.store.getState().notebook!), 'theorem');
      assert.equal(theoremOf(r.store.getState().notebook!)!.source, 'ai');
    } finally {
      r.dispose();
    }
  });

  it('Undo keeps a Lean verdict made for the same version of the line (no second request)', async () => {
    const api = leanApi((input) => okResult(input));
    const r = rig({ lines: [given, line('L2', 'VERIFYING', { segments: segs('By induction on $n$.'), extensions: { route: 'lean' } }), line('D1', 'DRAFT')], api });
    try {
      withLeanTheorem(r);
      await r.engine.verifyLine('L2');
      await until(() => !!leanOf(lineOf(r, 'L2')!)?.proof, 'verdict');
      r.engine.newLine();
      r.engine.undo();
      await r.engine.recheckStale();
      assert.ok(leanOf(lineOf(r, 'L2')!)?.proof);
      assert.equal(api.leanCalls.length, 1);
    } finally {
      r.dispose();
    }
  });
});

describe('Lean-checked suggestions (ADR 0007)', () => {
  const lines = (): Line[] => [given, proofLine('L1', 'Let $n$ be natural.', { route: 'lean', lean: { tactic: 'intro n', step: 'ok', proof: 'incomplete' } }), line('D1', 'DRAFT')];
  const proofDraft = (input: Parameters<typeof draftFor>[0]) => {
    const d = draftFor(input, 'We use induction on $n$.');
    d.candidate!.lines[0]!.route = 'lean';
    return d;
  };

  it('a suggested proof step Lean accepts is shown as verified and adopted with its verdict', async () => {
    const api = leanApi((input) => okResult(input));
    api.answer = proofDraft;
    const r = rig({ lines: lines(), api, cas: fakeCas(() => casStatus('none', { reason: 'TEXT_ONLY' })) });
    try {
      withLeanTheorem(r);
      await r.engine.requestSuggestion(true);
      const c = r.store.getState().candidate!;
      assert.equal(c.state, 'READY');
      assert.equal(c.policy, 'verified');
      const sent = api.leanCalls[0]!;
      assert.equal(sent.candidate, true);
      assert.deepEqual(sent.lines.map((l) => l.id), ['L1', c.targetLineId]);
      assert.equal(r.engine.adopt(), 'adopted');
      const adopted = lineOf(r, c.targetLineId)!;
      assert.equal(leanOf(adopted)?.step, 'ok');
      assert.equal(adopted.extensions?.route, 'lean');
      // its verdict was made for exactly this place in the proof: no new request
      assert.equal(leanOf(adopted)?.context_hash, leanContextHash(leanInput(r.store.getState().notebook!, adopted, 'en')));
    } finally {
      r.dispose();
    }
  });

  it('a step Lean refuses is never shown: the model is asked again with Lean’s message', async () => {
    let call = 0;
    const api = leanApi((input) => {
      call += 1;
      const target = input.lines.at(-1)!.id;
      return call === 1
        ? okResult(input, { state: 'failed', steps: input.lines.map((l) => ({ line_id: l.id, tactic: 'x', state: l.id === target ? 'failed' : 'ok', ...(l.id === target ? { message: 'linarith failed' } : {}) })) })
        : okResult(input);
    });
    api.answer = (input) => {
      const d = proofDraft(input);
      d.candidate!.content_hash = `sha256:${String(api.suggestCalls.length).repeat(64)}` as `sha256:${string}`;
      return d;
    };
    const r = rig({ lines: lines(), api, cas: fakeCas(() => casStatus('none', { reason: 'TEXT_ONLY' })) });
    try {
      withLeanTheorem(r);
      await r.engine.requestSuggestion(true);
      assert.equal(api.suggestCalls.length, 2);
      const feedback = api.suggestCalls[1]!.input.checker_feedback!;
      assert.equal(feedback[0]!.reason, 'LEAN_REJECTED');
      assert.deepEqual(feedback[0]!.evidence, ['linarith failed', 'Still to show: ⊢ …']);
      assert.equal(r.store.getState().candidate?.policy, 'verified');
    } finally {
      r.dispose();
    }
  });

  it('suggestions wait while a Lean check is running, and a finished proof has nothing to continue', async () => {
    const api = leanApi((input) => okResult(input));
    const r = rig({ lines: lines(), api });
    try {
      withLeanTheorem(r);
      r.store.getState().set('leanPending', { L1: true });
      assert.equal(r.engine.canSuggest(), false);
      r.store.getState().set('leanPending', {});
      assert.equal(r.engine.canSuggest(), true);
      r.store.getState().patchLine('L1', (l) => ({ ...l, extensions: { route: 'lean', lean: { tactic: 'intro n', step: 'ok', proof: 'proved' } } }));
      assert.equal(r.engine.canSuggest(), false);
    } finally {
      r.dispose();
    }
  });
});
