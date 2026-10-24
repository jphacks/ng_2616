import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { HELD_QUIET_MS } from '../../../src/core/engine';
import { line, settled } from './fixtures';
import { candidateOf, deferred, draftFor, fakeApi, rig, until, writeStroke, type Rig } from './harness';
import type { CandidateDraftResult } from '@mn/contracts';

let r: Rig;
beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'] }));
afterEach(() => {
  r?.dispose();
  mock.timers.reset();
});

const twoDrafts = () => [settled('L1', '$x = 1$', 'ok'), line('D1', 'DRAFT'), line('D2', 'DRAFT')];
const state = () => candidateOf(r)?.state ?? null;

/** Ask for a suggestion with the clock stopped and wait until it is shown. */
async function ready(lines = twoDrafts()) {
  r = rig({ lines });
  await r.engine.requestSuggestion(true);
  await until(() => state() === 'READY', 'READY');
  return candidateOf(r)!;
}

describe('R14: a hidden suggestion comes back after the pen has been quiet', () => {
  it('uses 1.2 seconds, the same wait as C-01', () => {
    assert.equal(HELD_QUIET_MS, 1200);
  });

  it('G3 HELD becomes READY exactly when 1.2 s have passed since the last stroke', async () => {
    const c = await ready();
    const other = c.targetLineId === 'D1' ? 'D2' : 'D1';
    writeStroke(r, other);
    assert.equal(state(), 'HELD');
    mock.timers.tick(HELD_QUIET_MS - 1);
    assert.equal(state(), 'HELD');
    mock.timers.tick(1);
    assert.equal(state(), 'READY');
  });

  it('G3 every new stroke starts the wait again', async () => {
    const c = await ready();
    const other = c.targetLineId === 'D1' ? 'D2' : 'D1';
    writeStroke(r, other);
    mock.timers.tick(1000);
    writeStroke(r, other);
    mock.timers.tick(1000);
    assert.equal(state(), 'HELD', 'only 1.0 s since the second stroke');
    mock.timers.tick(200);
    assert.equal(state(), 'READY');
  });

  it('G3 a changed context makes the suggestion STALE instead of showing it', async () => {
    const c = await ready();
    const other = c.targetLineId === 'D1' ? 'D2' : 'D1';
    writeStroke(r, other);
    r.store.getState().bumpEpoch(); // e.g. another line was confirmed
    mock.timers.tick(HELD_QUIET_MS);
    assert.equal(state(), null);
  });

  it('G3 an edit to a line the suggestion was made from also makes it STALE', async () => {
    const c = await ready();
    const other = c.targetLineId === 'D1' ? 'D2' : 'D1';
    writeStroke(r, other);
    r.store.getState().patchLine('L1', (l) => ({ ...l, version: l.version + 1 }));
    mock.timers.tick(HELD_QUIET_MS);
    assert.equal(state(), null);
  });

  it('G3 a suggestion for the very draft being written stays hidden (it would replace the ink)', async () => {
    const c = await ready();
    writeStroke(r, c.targetLineId);
    assert.equal(state(), 'HELD');
    mock.timers.tick(10 * HELD_QUIET_MS);
    assert.equal(state(), 'HELD');
    // emptying the draft releases it, as before
    const ids = r.store.getState().notebook!.lines.find((l) => l.id === c.targetLineId)!.ink.map((s) => s.id);
    r.engine.eraseStrokes(c.targetLineId, ids);
    assert.equal(state(), 'READY');
  });

  it('G3 a suggestion that arrives while writing is hidden, then shown after the quiet time', async () => {
    r = rig({ lines: twoDrafts() });
    const gate = deferred<CandidateDraftResult>();
    r.api.answer = (input) => gate.promise.then(() => draftFor(input, 'x = 2'));
    void r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 1, 'the request');
    const target = candidateOf(r)!.targetLineId;
    writeStroke(r, target === 'D1' ? 'D2' : 'D1'); // the student starts writing elsewhere while it is being made
    gate.resolve(draftFor(r.api.suggestCalls[0]!.input, 'x = 2'));
    await until(() => state() === 'HELD', 'HELD on arrival');
    mock.timers.tick(HELD_QUIET_MS);
    assert.equal(state(), 'READY');
  });

  it('G3 a disposed engine leaves no timer behind', async () => {
    const c = await ready();
    writeStroke(r, c.targetLineId === 'D1' ? 'D2' : 'D1');
    r.dispose();
    assert.doesNotThrow(() => mock.timers.tick(5 * HELD_QUIET_MS));
  });
});
