import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { CandidateDraftResult } from '@mn/contracts';
import { SUGGEST_ATTEMPTS } from '../../../src/core/suggest/attempts';
import { line, settled, stroke } from './fixtures';
import { candidateOf, casStatus, deferred, draftFor, fakeApi, fakeCas, lineOf, rig, tick, until, writeStroke, type Rig } from './harness';

let r: Rig;
afterEach(() => {
  r?.dispose();
  mock.timers.reset();
});

/** Ask for a suggestion and wait until the candidate is shown (READY or HELD). */
async function suggestAndSettle(rg: Rig, manual = true) {
  await rg.engine.requestSuggestion(manual);
  await until(() => ['READY', 'HELD'].includes(candidateOf(rg)?.state ?? ''), 'a finished candidate');
}

const unreadable = settled('L1', '$x = 1$', 'unknown', 'UNREADABLE');
const incomplete = (ink = false) => settled('L1', '$A = $', 'unknown', 'INCOMPLETE', ink ? { ink: [stroke] } : {});

describe('engine harness', () => {
  it('a suggestion for an ok line becomes a READY candidate', async () => {
    r = rig();
    await suggestAndSettle(r);
    const c = candidateOf(r)!;
    assert.equal(c.state, 'READY');
    assert.equal(c.mode, 'NEXT_STEP');
    assert.equal(c.policy, 'verified');
    assert.equal(r.api.suggestCalls.length, 1);
    assert.equal(r.cas.verified.length, 1);
  });
});

describe('R13: writing on any draft line hides a ready suggestion', () => {
  it('G4 a stroke on the line the suggestion is for turns READY into HELD', async () => {
    r = rig();
    await suggestAndSettle(r);
    const c = candidateOf(r)!;
    writeStroke(r, c.targetLineId);
    assert.equal(candidateOf(r)!.state, 'HELD');
  });

  it('G4 a stroke on a different draft line also turns READY into HELD', async () => {
    r = rig({ lines: [settled('L1', '$x = 1$', 'ok'), line('D1', 'DRAFT'), line('D2', 'DRAFT')] });
    await suggestAndSettle(r);
    const c = candidateOf(r)!;
    const other = ['D1', 'D2'].find((id) => id !== c.targetLineId)!;
    writeStroke(r, other);
    assert.equal(candidateOf(r)!.state, 'HELD');
  });

  it('G4 strokes do not touch a candidate that is not READY', async () => {
    r = rig();
    await tick();
    writeStroke(r, r.draftId);
    assert.equal(candidateOf(r), null);
  });
});

describe('when a suggestion may start (R4, R10)', () => {
  it('an adopted PDF question starts manually without inventing a first handwritten line', async () => {
    r = rig({ lines: [settled('P1', '$\\int_1^2 x\\,dx$', 'none', 'PREMISE', { source: 'pdf', role: 'premise', document_origin: { name: 'integral-worksheet.pdf', page: 1, has_unreadable: false } }), line('D1', 'DRAFT')] });
    assert.equal(r.engine.canSuggest(false), false);
    assert.equal(r.engine.canSuggest(true), true);
    await r.engine.requestSuggestion(false);
    assert.equal(r.api.suggestCalls.length, 0);
    await suggestAndSettle(r);
    assert.equal(r.api.suggestCalls.length, 1);
    assert.equal(r.api.suggestCalls[0]!.input.based_on_line_id, 'P1');
  });

  it('a template or manually marked given still waits for the student to write', async () => {
    r = rig({ lines: [settled('P1', '$x=1$', 'none', 'PREMISE', { role: 'premise' }), line('D1', 'DRAFT')] });
    assert.equal(r.engine.canSuggest(true), false);
    await r.engine.requestSuggestion(true);
    assert.equal(r.api.suggestCalls.length, 0);
  });

  const none = (name: string, setup: () => Rig, toast?: string) =>
    it(`G1 ${name}: no request is sent`, async () => {
      r = setup();
      await r.engine.requestSuggestion(true);
      await tick();
      assert.equal(r.api.suggestCalls.length, 0);
      assert.equal(candidateOf(r), null);
      if (toast) assert.deepEqual(r.toasts, [toast]);
    });

  none('a wrong line is on the page', () => rig({ lines: [settled('L1', '$x = 1$'), settled('W', '$x = 2$', 'wrong'), line('D1', 'DRAFT')] }), 'toast.fixWrongFirst');
  none('an unresolved recovery', () => {
    const rg = rig();
    rg.store.getState().set('notebook', { ...rg.store.getState().notebook!, recoveries: [{ root_line_id: 'W', current_line_id: 'R', phase: 'UNRESOLVED', opened_at: {} }] });
    return rg;
  }, 'toast.fixWrongFirst');
  none('the checker is not ready', () => {
    const cas = fakeCas();
    cas.ready = false;
    return rig({ cas });
  }, 'toast.casLoading');
  none('nothing has been written yet', () => rig({ lines: [line('D1', 'DRAFT')] }), 'toast.writeFirst');
  none('a line is still being recognized', () => rig({ lines: [settled('L1', '$x = 1$'), line('P', 'RECOGNIZING'), line('D1', 'DRAFT')] }), 'toast.suggestPending');
  none('the last line cannot be continued', () => rig({ lines: [unreadable, line('D1', 'DRAFT')] }), 'toast.suggestCannotContinue');
  none('the student is writing', () => rig({ lines: [settled('L1', '$x = 1$'), line('D1', 'DRAFT', { ink: [stroke] })] }), 'toast.confirmFirst');

  it('G1 an automatic request says nothing when it cannot start', async () => {
    r = rig({ lines: [unreadable, line('D1', 'DRAFT')] });
    await r.engine.requestSuggestion(false);
    assert.deepEqual(r.toasts, []);
    assert.equal(r.api.suggestCalls.length, 0);
  });

  it('G1 while a suggestion exists the button answers instead of starting another', async () => {
    r = rig();
    await suggestAndSettle(r);
    await r.engine.requestSuggestion(true);
    assert.equal(r.api.suggestCalls.length, 1);
    assert.deepEqual(r.toasts, ['toast.suggestBusy']);
    writeStroke(r, r.draftId);
    assert.equal(candidateOf(r)!.state, 'HELD');
    await r.engine.requestSuggestion(true);
    assert.equal(r.api.suggestCalls.length, 1);
    assert.deepEqual(r.toasts.at(-1), 'toast.suggestHeld');
  });
});

describe('what is sent (R5, R16)', () => {
  it('G2 NEXT_STEP: the slot meta, the reserved draft as target, no lhs_expr, nothing rejected yet', async () => {
    r = rig();
    await suggestAndSettle(r);
    const { meta, input } = r.api.suggestCalls[0]!;
    const nb = r.store.getState().notebook!;
    assert.deepEqual(Object.keys(meta).sort(), ['client_epoch', 'client_session_id', 'context_fingerprint', 'line_id', 'line_version', 'notebook_id', 'request_id']);
    assert.equal(meta.notebook_id, nb.id);
    assert.equal(meta.client_session_id, r.engine.sessionId);
    assert.equal(meta.client_epoch, r.store.getState().epoch);
    assert.equal(meta.line_id, 'L1');
    assert.equal(meta.line_version, lineOf(r, 'L1')!.version);
    assert.match(meta.context_fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(input.mode, 'NEXT_STEP');
    assert.equal(input.based_on_line_id, 'L1');
    assert.equal(input.target_line_id, 'D1');
    assert.equal('lhs_expr' in input, false);
    assert.deepEqual(input.rejected_hashes, []);
    assert.deepEqual(input.context.lines.map((l) => l.id), ['L1']);
  });

  it('G2 COMPLETE_RHS for an unfinished "A =": the line itself is the target and its left side is sent', async () => {
    r = rig({ lines: [settled('L0', '$x = 1$', 'ok'), incomplete(), line('D1', 'DRAFT')] });
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 1, 'the request');
    const { input } = r.api.suggestCalls[0]!;
    assert.equal(input.mode, 'COMPLETE_RHS');
    assert.equal(input.target_line_id, 'L1');
    assert.equal(input.based_on_line_id, 'L1');
    assert.equal(input.lhs_expr, 'A');
  });

  it('G2 at most 64 lines are sent, the most recent ones', async () => {
    const many = Array.from({ length: 70 }, (_, i) => settled(`M${i}`, `$x = ${i}$`, 'ok'));
    r = rig({ lines: [...many, line('D1', 'DRAFT')] });
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 1, 'the request');
    const ids = r.api.suggestCalls[0]!.input.context.lines.map((l) => l.id);
    assert.equal(ids.length, 64);
    assert.equal(ids.at(-1), 'M69');
  });

  it('G2 the request carries a fresh request id each time, and the meta is the slot the result is matched with', async () => {
    r = rig();
    await suggestAndSettle(r);
    r.engine.reject();
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 2, 'the second request');
    const [a, b] = r.api.suggestCalls;
    assert.notEqual(a!.meta.request_id, b!.meta.request_id);
  });
});

describe('results that no longer match (R15, R16, R17)', () => {
  /** Start a request and hold its answer back. */
  async function inFlight(lines = [settled('L1', '$x = 1$', 'ok'), line('D1', 'DRAFT')]) {
    r = rig({ lines });
    const gate = deferred<CandidateDraftResult>();
    r.api.answer = () => gate.promise;
    void r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 1, 'the request');
    assert.equal(candidateOf(r)!.state, 'GENERATING');
    return { gate, call: r.api.suggestCalls[0]! };
  }

  it('G5 starting a revision cancels the request and no suggestion appears', async () => {
    const { gate, call } = await inFlight();
    r.engine.startRevision('L1');
    assert.equal(call.signal!.aborted, true);
    gate.resolve(draftFor(call.input, 'x = 2'));
    await tick();
    assert.equal(candidateOf(r), null);
    assert.equal(r.store.getState().suggesting, false);
  });

  it('G5 changing the problem (marking a line as given) cancels the request', async () => {
    const { gate, call } = await inFlight();
    r.engine.setGiven('L1', true);
    assert.equal(call.signal!.aborted, true);
    gate.resolve(draftFor(call.input, 'x = 2'));
    await tick();
    assert.equal(candidateOf(r), null);
  });

  it('G5 Undo and a new epoch cancel the request', async () => {
    const { call } = await inFlight();
    r.store.getState().bumpEpoch(); // what confirming a line does first
    assert.equal(call.signal!.aborted, true);
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.equal(candidateOf(r), null);
  });

  it('G6 a result is dropped, and leaves no candidate behind, when a line it was made from was edited meanwhile', async () => {
    const { gate, call } = await inFlight();
    r.store.getState().patchLine('L1', (l) => ({ ...l, version: l.version + 1 }));
    gate.resolve(draftFor(call.input, 'x = 2'));
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.equal(candidateOf(r), null, 'no VERIFYING candidate stays behind to block the next request');
    assert.equal(r.cas.verified.length, 0, 'a stale result is not even checked');
  });

  it('G6 strokes on a draft do not make a result stale: it arrives hidden instead', async () => {
    const { gate, call } = await inFlight();
    writeStroke(r, 'D1');
    gate.resolve(draftFor(call.input, 'x = 2'));
    await until(() => candidateOf(r)?.state === 'HELD', 'a held candidate');
  });

  it('G6 a result that finishes checking after the context changed is dropped', async () => {
    r = rig();
    const gate = deferred<ReturnType<typeof casStatus>>();
    r.cas.answer = () => gate.promise;
    void r.engine.requestSuggestion(true);
    await until(() => r.cas.verified.length === 1, 'the check to start');
    r.store.getState().patchLine('L1', (l) => ({ ...l, version: l.version + 1 }));
    gate.resolve(casStatus('ok'));
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.equal(candidateOf(r), null);
  });
});

describe('checker verdicts on candidates (ADR 0003)', () => {
  it('G7 a wrong candidate is never shown; it is asked for again, up to three calls, without the rejected ones', async () => {
    let n = 0;
    r = rig();
    r.api.answer = (input) => draftFor(input, `x = ${n + 2}`, `sha256:${String(n++ + 1).repeat(64)}`);
    r.cas.answer = () => casStatus('wrong');
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === SUGGEST_ATTEMPTS && !r.store.getState().suggesting && candidateOf(r) === null, 'all attempts to end');
    assert.equal(r.api.suggestCalls.length, SUGGEST_ATTEMPTS, 'retried with the checker feedback, then given up (PR #50)');
    assert.deepEqual(r.api.suggestCalls[1]!.input.rejected_hashes, [`sha256:${'1'.repeat(64)}`]);
    assert.deepEqual(r.api.suggestCalls[2]!.input.rejected_hashes, [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`]);
    assert.ok(r.store.getState().rejection, 'the "checker rejected a suggestion" chip is available');
  });

  it('G7 a wrong candidate followed by a good one: the good one is shown', async () => {
    let n = 0;
    r = rig();
    r.api.answer = (input) => draftFor(input, `x = ${n + 2}`, `sha256:${String(n++ + 1).repeat(64)}`);
    r.cas.answer = () => (r.cas.verified.length === 1 ? casStatus('wrong') : casStatus('ok'));
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'the second candidate');
    assert.equal(r.api.suggestCalls.length, 2);
    assert.equal(candidateOf(r)!.policy, 'verified');
  });

  it('G7 unknown becomes an amber candidate, none an assumption', async () => {
    r = rig();
    r.cas.answer = () => casStatus('unknown', { reason: 'NO_EVIDENCE' });
    await suggestAndSettle(r);
    assert.equal(candidateOf(r)!.policy, 'unverified');
    r.dispose();
    r = rig();
    r.cas.answer = () => casStatus('none', { reason: 'DEFINITION' });
    await suggestAndSettle(r);
    assert.equal(candidateOf(r)!.policy, 'assumption');
  });
});

describe('no suggestion, failure, and cancellation leave the notebook alone (R27, R31, R36)', () => {
  const none = (): CandidateDraftResult => ({ state: 'NONE', reason: 'MODEL_DECLINED', mock: false });

  it('G8 no suggestion: a manual press says so, an automatic request does not', async () => {
    r = rig();
    r.api.answer = none;
    const before = r.store.getState().notebook!.lines;
    await r.engine.requestSuggestion(true);
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.deepEqual(r.toasts, ['toast.noSuggestion']);
    assert.equal(candidateOf(r), null);
    assert.deepEqual(r.store.getState().notebook!.lines, before);
    await r.engine.requestSuggestion(false);
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.deepEqual(r.toasts, ['toast.noSuggestion'], 'the automatic one stayed silent');
  });

  it('G8 a failed request: a manual press shows the error, the page is unchanged, the next request can start', async () => {
    r = rig();
    r.api.answer = () => {
      throw new Error('boom');
    };
    const before = r.store.getState().notebook!.lines;
    const warn = mock.method(console, 'warn', () => undefined);
    await r.engine.requestSuggestion(true);
    await until(() => !r.store.getState().suggesting, 'the request to end');
    warn.mock.restore();
    assert.deepEqual(r.toasts, ['toast.suggestFailed']);
    assert.equal(candidateOf(r), null);
    assert.deepEqual(r.store.getState().notebook!.lines, before);
    r.api.answer = (input) => draftFor(input, 'x = 2');
    await suggestAndSettle(r);
    assert.equal(candidateOf(r)!.state, 'READY');
  });

  it('G8 the checker going away mid-way ends the request without a candidate', async () => {
    r = rig();
    r.cas.answer = () => ({ kind: 'unavailable' });
    await r.engine.requestSuggestion(true);
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.equal(candidateOf(r), null);
  });
});

describe('rejecting (R21, R22)', () => {
  it('G9 pressing Esc while a candidate is still being made records nothing and cancels the request', async () => {
    r = rig();
    const gate = deferred<CandidateDraftResult>();
    r.api.answer = () => gate.promise;
    void r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 1, 'the request to be sent');
    assert.equal(candidateOf(r)!.state, 'GENERATING');
    r.engine.reject();
    assert.deepEqual(r.store.getState().rejections, {});
    assert.equal(r.api.suggestCalls[0]!.signal!.aborted, true);
    assert.equal(candidateOf(r), null);
  });

  it('G9 the same while it is being checked', async () => {
    r = rig();
    const gate = deferred<ReturnType<typeof casStatus>>();
    r.cas.answer = () => gate.promise;
    void r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'VERIFYING', 'VERIFYING');
    r.engine.reject();
    assert.deepEqual(r.store.getState().rejections, {});
    gate.resolve(casStatus('ok'));
    await until(() => !r.store.getState().suggesting, 'the request to end');
    assert.equal(candidateOf(r), null, 'a rejected candidate does not come back when its check finishes');
  });

  it('G9 rejecting a shown candidate records its hash, leaves the page alone, and the next request sends it', async () => {
    r = rig();
    r.api.answer = (input) => draftFor(input, 'x = 2', `sha256:${'b'.repeat(64)}`);
    await suggestAndSettle(r);
    const before = r.store.getState().notebook!.lines;
    r.engine.reject();
    assert.equal(candidateOf(r), null);
    assert.deepEqual(r.store.getState().notebook!.lines, before);
    assert.equal(r.store.getState().past.length, 0, 'rejecting is not an undoable command (v2.1)');
    r.api.answer = (input) => draftFor(input, 'x = 3', `sha256:${'c'.repeat(64)}`);
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 2, 'the second request');
    assert.deepEqual(r.api.suggestCalls[1]!.input.rejected_hashes, [`sha256:${'b'.repeat(64)}`]);
  });

  it('G9 a rejection counts only in its own context', async () => {
    r = rig({ lines: [settled('L1', '$x = 1$', 'ok'), line('D1', 'DRAFT')] });
    r.api.answer = (input) => draftFor(input, 'x = 2', `sha256:${'b'.repeat(64)}`);
    await suggestAndSettle(r);
    r.engine.reject();
    // the page changes: another ok line is settled after L1
    r.store.getState().settleLine(settled('L2', '$x = 5$', 'ok'));
    r.store.getState().set('notebook', { ...r.store.getState().notebook!, lines: [settled('L1', '$x = 1$', 'ok'), settled('L2', '$x = 5$', 'ok'), line('D1', 'DRAFT')] });
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 2, 'the second request');
    assert.deepEqual(r.api.suggestCalls[1]!.input.rejected_hashes, []);
  });
});

describe('automatic suggestions (v2.1) (R26)', () => {
  it('G10 a suggestion is requested 1.2 s after the page settles, once', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    r.engine.scheduleSuggestion();
    mock.timers.tick(1199);
    assert.equal(r.api.suggestCalls.length, 0);
    mock.timers.tick(1);
    await until(() => r.api.suggestCalls.length === 1, 'the automatic request');
    await until(() => candidateOf(r)?.state === 'READY', 'READY');
    r.engine.scheduleSuggestion();
    mock.timers.tick(10_000);
    await tick();
    assert.equal(r.api.suggestCalls.length, 1, 'no second request while a suggestion exists');
  });

  it('G10 a stroke cancels the wait', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    r.engine.scheduleSuggestion();
    mock.timers.tick(600);
    writeStroke(r, r.draftId);
    mock.timers.tick(10_000);
    await tick();
    assert.equal(r.api.suggestCalls.length, 0);
  });

  it('G10 nothing is scheduled when a suggestion cannot start', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig({ lines: [settled('L1', '$x = 1$'), settled('W', '$x = 2$', 'wrong'), line('D1', 'DRAFT')] });
    r.engine.scheduleSuggestion();
    mock.timers.tick(10_000);
    await tick();
    assert.equal(r.api.suggestCalls.length, 0);
  });
});

// keep fakeApi referenced for readers who build their own rigs from this file
void fakeApi;
