import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { candidateOf, draftFor, rig, tick, until, writeStroke, type Rig } from './harness';

let r: Rig;
afterEach(() => r?.dispose());

/** Ask for a suggestion and wait until the candidate is shown (READY or HELD). */
async function suggestAndSettle(rg: Rig, manual = true) {
  await rg.engine.requestSuggestion(manual);
  await until(() => ['READY', 'HELD'].includes(candidateOf(rg)?.state ?? ''), 'a finished candidate');
}

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
    const { line, settled } = await import('./fixtures');
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
