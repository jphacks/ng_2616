import { describe, it } from 'node:test';

// Behaviour the spec requires but the current code does not provide (NOTES, "段階0' 差分調査").
// Each test is skipped, not deleted: it becomes a real test when the owner of the file named below
// has agreed to the change. Do not fill these in by editing the files of other owners.
//
// The pure helpers they will use already exist in src/core/candidates (blocker, slot, rejection);
// what is missing is that engine.ts / notebook-store.ts call them.

describe('waiting for the Canvas/history owner (engine.ts, notebook-store.ts)', () => {
  // Needs engine.ts to accept a fake CAS and a fake api (today: `private cas = getCas()`, direct `api` import).
  it.skip('D3 canSuggest(manual) and requestSuggestion agree while a candidate is HELD (R27)', () => {});

  // R13: addStroke only holds the candidate when the stroke lands on the candidate's target line.
  it.skip('G4 writing on any draft line turns a READY candidate into HELD (R13)', () => {});

  // R17: undo/redo abort the suggest request; confirmLine, startRevision and editProblem do not.
  it.skip('G5 confirming, starting a revision or editing the problem aborts the suggest request (R17)', () => {});

  // R16: NotebookEngine.isStale now compares all seven slot fields via matchesSlot (rules tested in pure.test.ts).
  // The wiring (request superseded, context line edited, epoch bumped) needs a fake CAS and api (constructor owner).
  it.skip('G6 engine wiring: a result whose request_id or context_fingerprint differs from the active slot is discarded (R16)', () => {});

  // R22: the pure rules (empty hash, READY/HELD only, per-context key) are tested in pure.test.ts (F3, G9).
  // What stays here is the wiring inside NotebookEngine.reject(), which needs a fake CAS and api (constructor owner).
  it.skip('G9 pressing Esc while a candidate is still being generated leaves the rejection history unchanged (engine wiring, R22)', () => {});

  // R14: HELD returns to READY only when the draft is emptied; the definition of "writing stopped" is not agreed yet.
  it.skip('G3 a HELD candidate returns to READY once writing has stopped in an unchanged context (R14)', () => {});
});

describe('waiting for the UI owner (ghost-line.tsx, i18n)', () => {
  // R12: GhostLine ignores depends_on_unverified / unverified_ancestors. Needs a component test setup (none exists).
  it.skip('I2 an ok candidate with unverified ancestors is labelled "local step consistent (unverified: line N)" (R12)', () => {});
});
