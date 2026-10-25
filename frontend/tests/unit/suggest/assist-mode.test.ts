import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { blockerToastKey, hintsAllowedIn, suggestBlockerOf } from '../../../src/core/candidates/blocker';
import { line, notebook, settled } from './fixtures';
import { candidateOf, deferred, draftFor, fakeApi, rig, until, type Rig } from './harness';
import type { CandidateDraftResult } from '@mn/contracts';

let r: Rig;
afterEach(() => {
  // the store is shared by every test
  r?.store.setState({ assistMode: 'complete' });
  r?.dispose();
});

const calls = () => r.api.suggestCalls.length;

describe('S-02 assist modes (spec §14.2)', () => {
  it('A1 the default is complete: a suggestion starts as before', async () => {
    r = rig();
    assert.equal(r.store.getState().assistMode, 'complete');
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'READY');
    assert.equal(calls(), 1);
  });

  it('A2 in hint mode no request is sent, by the button or by the timer', async () => {
    r = rig();
    r.engine.setAssistMode('hint');
    await r.engine.requestSuggestion(true);
    await r.engine.requestSuggestion(false);
    r.engine.scheduleSuggestion(0);
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(calls(), 0);
    assert.equal(r.engine.canSuggest(true), false);
    assert.equal(candidateOf(r), null);
  });

  it('A3 pressing the button in hint mode explains why', async () => {
    r = rig();
    r.engine.setAssistMode('hint');
    await r.engine.requestSuggestion(true);
    assert.deepEqual(r.toasts, ['toast.suggestHintMode']);
  });

  it('A4 switching to hint removes a shown suggestion; switching back completes again', async () => {
    r = rig();
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'READY');
    r.engine.setAssistMode('hint');
    assert.equal(candidateOf(r), null);
    r.engine.setAssistMode('complete');
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'READY again');
    assert.equal(calls(), 2);
  });

  it('A5 a switch moves the epoch and stops a request in flight; its late result shows nothing', async () => {
    r = rig();
    const late = deferred<CandidateDraftResult>();
    r.api.answer = () => late.promise;
    void r.engine.requestSuggestion(true);
    await until(() => calls() === 1, 'the request');
    const epoch = r.store.getState().epoch;
    r.engine.setAssistMode('hint');
    assert.ok(r.store.getState().epoch > epoch);
    assert.equal(r.api.suggestCalls[0]!.signal!.aborted, true);
    assert.equal(r.store.getState().suggesting, false);
    late.resolve(draftFor(r.api.suggestCalls[0]!.input, 'x = 2'));
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(candidateOf(r), null);
  });

  it('A6 setting the mode it already has changes nothing (no epoch move, candidate kept)', async () => {
    r = rig();
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'READY');
    const epoch = r.store.getState().epoch;
    r.engine.setAssistMode('complete');
    assert.equal(r.store.getState().epoch, epoch);
    assert.equal(candidateOf(r)?.state, 'READY');
  });

  it('A7 hint mode does not touch the lines or the history', async () => {
    r = rig();
    const before = r.store.getState().notebook!.lines;
    const past = r.store.getState().past.length;
    r.engine.setAssistMode('hint');
    r.engine.setAssistMode('complete');
    assert.equal(r.store.getState().notebook!.lines, before);
    assert.equal(r.store.getState().past.length, past);
  });

  it('A8 the pure rule: hint wins over everything else; absent mode means complete', () => {
    const base = { notebook: notebook([settled('L1', '$x = 1$'), line('D1', 'DRAFT')]), casReady: true, candidate: null, activeLine: undefined };
    assert.equal(suggestBlockerOf({ ...base, assistMode: 'hint' }), 'hint-mode');
    assert.equal(suggestBlockerOf({ ...base, casReady: false, assistMode: 'hint' }), 'hint-mode');
    assert.equal(suggestBlockerOf(base), null);
    assert.equal(suggestBlockerOf({ ...base, assistMode: 'complete' }), null);
    assert.equal(blockerToastKey('hint-mode', null), 'toast.suggestHintMode');
  });

  it('A10 off: no request by the button or the timer, its own explanation, and the candidate and request are dropped', async () => {
    r = rig();
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'READY');
    r.engine.setAssistMode('off');
    assert.equal(candidateOf(r), null);
    const before = calls();
    await r.engine.requestSuggestion(true);
    r.engine.scheduleSuggestion(0);
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(calls(), before);
    assert.deepEqual(r.toasts, ['toast.suggestAssistOff']);
    assert.equal(r.engine.canSuggest(true), false);
  });

  it('A11 hint, off and complete switch among each other; every change moves the epoch', () => {
    r = rig();
    for (const mode of ['hint', 'off', 'complete', 'off', 'hint'] as const) {
      const epoch = r.store.getState().epoch;
      r.engine.setAssistMode(mode);
      assert.equal(r.store.getState().assistMode, mode);
      assert.ok(r.store.getState().epoch > epoch);
    }
    assert.equal(suggestBlockerOf({ notebook: notebook([settled('L1', '$x = 1$')]), casReady: true, candidate: null, activeLine: undefined, assistMode: 'off' }), 'assist-off');
    assert.equal(blockerToastKey('assist-off', null), 'toast.suggestAssistOff');
  });

  it('A9 an unused api is fine: hint mode never needs the checker or the model', () => {
    r = rig({ api: fakeApi(() => assert.fail('the model must not be called')) });
    r.engine.setAssistMode('hint');
    assert.equal(r.engine.canSuggest(false), false);
  });

  it('A12 off withholds the recovery hints; hint, complete and an unset mode keep them', () => {
    assert.equal(hintsAllowedIn('off'), false);
    assert.equal(hintsAllowedIn('hint'), true);
    assert.equal(hintsAllowedIn('complete'), true);
    assert.equal(hintsAllowedIn(undefined), true);
  });
});
