import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { line, settled, stroke } from './fixtures';
import { candidateOf, casStatus, draftFor, lineOf, rig, until, writeStroke, type Rig } from './harness';

let r: Rig;
afterEach(() => {
  r?.dispose();
  mock.timers.reset();
});

async function suggest(rg: Rig) {
  await rg.engine.requestSuggestion(true);
  await until(() => ['READY', 'HELD'].includes(candidateOf(rg)?.state ?? ''), 'a finished candidate');
  return candidateOf(rg)!;
}

const lines = () => r.store.getState().notebook!.lines;
const commands = () => r.store.getState().past.filter((c) => c.type === 'ADOPT_CANDIDATE');
const incomplete = (ink = false) => settled('L1', '$A = $', 'unknown', 'INCOMPLETE', ink ? { ink: [stroke] } : {});

describe('adopting a NEXT_STEP suggestion (R19)', () => {
  it('E1 it becomes an AI line on the reserved draft, with its verification and origin; no request is sent', async () => {
    r = rig();
    const c = await suggest(r);
    const calls = r.api.suggestCalls.length;
    assert.equal(r.engine.adopt(), 'adopted');
    const ai = lineOf(r, c.targetLineId)!;
    assert.equal(ai.source, 'ai');
    assert.equal(ai.role, 'step');
    assert.equal(ai.state, 'SETTLED');
    assert.deepEqual(ai.ink, []);
    assert.equal(ai.segments, c.lines[0]!.segments);
    assert.equal(ai.verified, c.lines[0]!.verified);
    assert.deepEqual(ai.ai_origin, { candidate_id: c.id, mode: 'NEXT_STEP' });
    assert.deepEqual(lines().map((l) => l.id).slice(0, 2), ['L1', c.targetLineId], 'right after the line it follows');
    assert.equal(lines().at(-1)!.state, 'DRAFT', 'a fresh draft follows for the student');
    assert.equal(candidateOf(r), null);
    assert.equal(r.api.suggestCalls.length, calls, 'adopting calls no API');
  });

  it('E2 with no draft below, the AI line is inserted after the line it follows and a draft is added', async () => {
    r = rig({ lines: [settled('L1', '$x = 1$', 'ok')] });
    const c = await suggest(r);
    assert.equal(r.engine.adopt(), 'adopted');
    assert.deepEqual(lines().map((l) => [l.id, l.state]), [['L1', 'SETTLED'], [c.targetLineId, 'SETTLED'], [lines()[2]!.id, 'DRAFT']]);
    assert.equal(r.store.getState().activeLineId, lines()[2]!.id);
  });

  it('E1 adoption is one undoable command that holds the finished lines', async () => {
    r = rig();
    await suggest(r);
    r.engine.adopt();
    const [cmd] = commands();
    assert.equal(commands().length, 1);
    assert.equal(cmd!.after.lines.find((l) => l.source === 'ai')!.verified?.proof.status, 'ok');
    assert.equal(cmd!.before.lines.some((l) => l.source === 'ai'), false);
  });
});

describe('adopting a COMPLETE_RHS suggestion (R19)', () => {
  it('E3 the right-hand side is filled in: segments replaced, version +1, the student’s ink kept, origin recorded', async () => {
    r = rig({ lines: [incomplete(true), line('D1', 'DRAFT')] });
    r.api.answer = (input) => draftFor(input, 'A = 2');
    const c = await suggest(r);
    assert.equal(c.mode, 'COMPLETE_RHS');
    const before = lineOf(r, 'L1')!;
    assert.equal(r.engine.adopt(), 'adopted');
    const after = lineOf(r, 'L1')!;
    assert.equal(after.version, before.version + 1);
    assert.equal(after.segments, c.lines[0]!.segments);
    assert.equal(after.verified, c.lines[0]!.verified);
    assert.deepEqual(after.ink, before.ink, 'the original handwriting is kept');
    assert.equal(after.source, 'user');
    assert.deepEqual(after.ai_origin, { candidate_id: c.id, mode: 'COMPLETE_RHS' });
    assert.equal(lines().length, 2, 'no line was added');
  });
});

describe('adopting only once, and only when it is still right (R11, R18)', () => {
  it('E4 a second press does nothing: one command, one change', async () => {
    r = rig();
    await suggest(r);
    assert.equal(r.engine.adopt(), 'adopted');
    const snapshot = lines();
    assert.equal(r.engine.adopt(), 'none');
    assert.equal(r.engine.adopt(), 'none');
    assert.equal(commands().length, 1);
    assert.equal(lines(), snapshot);
  });

  it('E5 after the epoch moved it is stale: dropped, nothing changes', async () => {
    r = rig();
    await suggest(r);
    const before = lines();
    r.store.getState().bumpEpoch();
    assert.equal(r.engine.adopt(), 'stale');
    assert.equal(candidateOf(r), null);
    assert.equal(lines(), before);
  });

  it('E5 after an unresolved error appeared it is stale', async () => {
    r = rig();
    await suggest(r);
    const nb = r.store.getState().notebook!;
    r.store.getState().set('notebook', { ...nb, recoveries: [{ root_line_id: 'W', current_line_id: 'R', phase: 'UNRESOLVED', opened_at: {} }] });
    assert.equal(r.engine.adopt(), 'stale');
    assert.equal(candidateOf(r), null);
    assert.equal(commands().length, 0);
  });

  it('E5 when the lines it was checked against changed (input hash differs) it is stale', async () => {
    r = rig();
    await suggest(r);
    r.store.getState().patchLine('L1', (l) => ({ ...l, verified: { ...l.verified!, proof: { ...l.verified!.proof, status: 'none' } } }));
    assert.equal(r.engine.adopt(), 'stale');
    assert.equal(commands().length, 0);
  });

  it('E7 a hidden (HELD) suggestion cannot be adopted', async () => {
    r = rig();
    await suggest(r);
    writeStroke(r, r.draftId);
    assert.equal(candidateOf(r)!.state, 'HELD');
    assert.equal(r.engine.adopt(), 'none');
    assert.equal(commands().length, 0);
  });
});

describe('unverified suggestions need a second confirmation (ADR 0003)', () => {
  it('E6 unknown: the first press asks, the second adopts and records it', async () => {
    r = rig();
    r.cas.answer = () => casStatus('unknown', { reason: 'NO_EVIDENCE' });
    const c = await suggest(r);
    assert.equal(c.policy, 'unverified');
    assert.equal(r.engine.adopt(), 'confirm');
    assert.equal(commands().length, 0);
    assert.equal(candidateOf(r)!.state, 'READY', 'the suggestion stays while it asks');
    assert.equal(r.engine.adopt(true), 'adopted');
    assert.deepEqual(lineOf(r, c.targetLineId)!.ai_origin, { candidate_id: c.id, mode: 'NEXT_STEP', unverified_adoption: true });
  });

  it('E6 ok and none adopt with one press and are not marked unverified', async () => {
    for (const status of ['ok', 'none'] as const) {
      r = rig();
      r.cas.answer = () => casStatus(status, status === 'none' ? { reason: 'DEFINITION' } : {});
      const c = await suggest(r);
      assert.equal(r.engine.adopt(), 'adopted', status);
      assert.equal(lineOf(r, c.targetLineId)!.ai_origin?.unverified_adoption, undefined, status);
      r.dispose();
    }
  });
});

describe('Undo and Redo of an adoption (R20)', () => {
  it('F1 Undo removes it, Redo brings the same finished line back, and neither calls the API or the checker', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    const c = await suggest(r);
    const before = lines();
    r.engine.adopt();
    const adopted = lines();
    const calls = r.api.suggestCalls.length;
    const checks = r.cas.verified.length;

    r.engine.undo();
    assert.deepEqual(lines(), before, 'the page is as it was before adopting');
    assert.equal(lineOf(r, c.targetLineId)!.source, 'user');

    r.engine.redo();
    assert.deepEqual(lines(), adopted, 'the same finished lines return');
    assert.equal(lineOf(r, c.targetLineId)!.verified, c.lines[0]!.verified, 'with the verification they were adopted with');
    assert.equal(r.api.suggestCalls.length, calls, 'no new request');
    assert.equal(r.cas.verified.length, checks, 'no new check');
  });

  it('F2 the epoch only goes up; Undo drops the candidate; a new edit after Undo clears the redo stack', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    await suggest(r);
    const e0 = r.store.getState().epoch;
    r.engine.adopt();
    const e1 = r.store.getState().epoch;
    assert.ok(e1 >= e0);
    r.engine.undo();
    const e2 = r.store.getState().epoch;
    assert.ok(e2 > e1, 'Undo moves the epoch');
    assert.equal(candidateOf(r), null);
    assert.equal(r.store.getState().future.length, 1);
    r.engine.redo();
    const e3 = r.store.getState().epoch;
    assert.ok(e3 > e2, 'Redo moves the epoch');
    r.engine.undo();
    writeStroke(r, r.draftId);
    assert.equal(r.store.getState().future.length, 0, 'a new edit clears what could be redone');
    assert.ok(r.store.getState().epoch >= e3, 'and it never goes back');
  });

  it('F2 Undo while a suggestion is being made cancels it', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    r.store.getState().commit('ADD_DRAFT', (snap) => ({ ...snap, lines: [...snap.lines, line('E', 'DRAFT')] }));
    r.api.answer = () => new Promise(() => undefined);
    void r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 1, 'the request');
    r.engine.undo();
    assert.equal(r.api.suggestCalls[0]!.signal!.aborted, true);
    assert.equal(candidateOf(r), null);
  });
});
