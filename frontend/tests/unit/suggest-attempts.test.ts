import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CheckerFeedback, Proof } from '@mn/contracts';
import { SUGGEST_ATTEMPTS, checkerFeedback, runAttempts, type Attempt } from '../../src/core/suggest/attempts';

const fb = (latex: string): CheckerFeedback => ({ latex, evidence: [`${latex} fails`] });
const wrong = (latex: string): Attempt<string> => ({ kind: 'wrong', hash: `h:${latex}`, feedback: fb(latex) });

/** Plays back scripted attempts and records what each call was given. */
function script(outcomes: Attempt<string>[]) {
  const calls: { feedback: CheckerFeedback[]; tried: string[] }[] = [];
  const attempt = async (feedback: CheckerFeedback[], tried: string[]) => {
    calls.push({ feedback, tried });
    const out = outcomes[calls.length - 1];
    if (!out) throw new Error('attempted more often than scripted');
    return out;
  };
  return { calls, attempt };
}

const proof = (extra: Partial<Proof>): Proof => ({
  status: 'wrong',
  conditions: [],
  evidence: [],
  hints: [],
  segment_results: [],
  depends_on: [],
  depends_on_unverified: false,
  unverified_ancestors: [],
  input_hash: 'x',
  mock: false,
  cas: { version: 'v', rules_version: '2.0.0', elapsed_ms: 1, timed_out: false },
  ...extra,
});

describe('suggestion attempts', () => {
  it('allows three model calls per request', () => {
    assert.equal(SUGGEST_ATTEMPTS, 3);
  });

  it('shows a ready candidate at once, without feedback on the first call', async () => {
    const { calls, attempt } = script([{ kind: 'ready', candidate: 'x = 2' }]);
    assert.deepEqual(await runAttempts(3, attempt), { kind: 'show', candidate: 'x = 2' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { feedback: [], tried: [] });
  });

  it('retries a wrong candidate with its checker feedback', async () => {
    const { calls, attempt } = script([wrong('x = 3'), { kind: 'ready', candidate: 'x = 2' }]);
    assert.deepEqual(await runAttempts(3, attempt), { kind: 'show', candidate: 'x = 2' });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]!.feedback, [fb('x = 3')]);
    assert.deepEqual(calls[1]!.tried, ['h:x = 3']);
  });

  it('accumulates feedback and stops after the attempt budget', async () => {
    const { calls, attempt } = script([wrong('a'), wrong('b'), wrong('c')]);
    assert.deepEqual(await runAttempts(3, attempt), { kind: 'none', rejected: 3 });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2]!.feedback.map((f) => f.latex), ['a', 'b']);
  });

  it('stops when the model has nothing more', async () => {
    const { calls, attempt } = script([wrong('w'), { kind: 'none' }]);
    assert.deepEqual(await runAttempts(3, attempt), { kind: 'none', rejected: 1 });
    assert.equal(calls.length, 2);
  });

  it('stops silently once the context goes stale', async () => {
    const { calls, attempt } = script([wrong('w'), { kind: 'stale' }]);
    assert.deepEqual(await runAttempts(3, attempt), { kind: 'stale' });
    assert.equal(calls.length, 2);
  });

  it('lets an aborted request end the loop', async () => {
    let calls = 0;
    const attempt = async (): Promise<Attempt<string>> => {
      calls++;
      if (calls === 2) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return wrong('w');
    };
    await assert.rejects(runAttempts(3, attempt), { name: 'AbortError' });
    assert.equal(calls, 2);
  });
});

describe('checker feedback', () => {
  it('carries the reason and evidence summaries, deduplicated and capped', () => {
    const ev = (summary: string) => ({ kind: 'COUNTEREXAMPLE' as const, summary });
    const f = checkerFeedback('x = 3', proof({
      reason: 'COUNTEREXAMPLE',
      evidence: [ev('At x = 1, the expected value is 2 but this line gives 3.'), ev('second')],
      segment_results: [{ segment_index: 0, status: 'wrong', conditions: [], evidence: [ev('second'), ev('third'), ev('fourth')] }],
    }));
    assert.deepEqual(f, {
      latex: 'x = 3',
      reason: 'COUNTEREXAMPLE',
      evidence: ['At x = 1, the expected value is 2 but this line gives 3.', 'second', 'third'],
    });
  });

  it('fits the contract limits', () => {
    const f = checkerFeedback('y'.repeat(5000), proof({ reason: 'R'.repeat(100), evidence: [{ kind: 'EXACT_MISMATCH', summary: 's'.repeat(900) }] }));
    assert.equal(f.latex.length, 4000);
    assert.equal(f.reason!.length, 64);
    assert.equal(f.evidence[0]!.length, 500);
    const bare = checkerFeedback('z', proof({}));
    assert.equal('reason' in bare, false);
    assert.deepEqual(bare.evidence, []);
  });
});
