import { describe, it } from 'node:test';

// Behaviour the spec requires but the current code does not provide (NOTES, "段階0' 差分調査").
// Each test is skipped, not deleted: it becomes a real test when the owner of the file named below
// has agreed to the change. Do not fill these in by editing the files of other owners.
//
// The pure helpers they will use already exist in src/core/candidates (blocker, slot, rejection);
// what is missing is that engine.ts / notebook-store.ts call them.

describe('waiting for the Canvas/history owner (engine.ts, notebook-store.ts)', () => {
  // R17: requestSuggestion now aborts itself on any epoch change (abortOnEpochChange, tested in epoch.test.ts).
  // The wiring inside NotebookEngine needs a fake CAS and api (constructor owner).
  it.skip('G5 engine wiring: confirming, starting a revision or editing the problem aborts the suggest request (R17)', () => {});

  // R16: NotebookEngine.isStale now compares all seven slot fields via matchesSlot (rules tested in pure.test.ts).
  // The wiring (request superseded, context line edited, epoch bumped) needs a fake CAS and api (constructor owner).
  it.skip('G6 engine wiring: a result whose request_id or context_fingerprint differs from the active slot is discarded (R16)', () => {});

  // R22: the pure rules (empty hash, READY/HELD only, per-context key) are tested in pure.test.ts (F3, G9).
  // What stays here is the wiring inside NotebookEngine.reject(), which needs a fake CAS and api (constructor owner).
  it.skip('G9 pressing Esc while a candidate is still being generated leaves the rejection history unchanged (engine wiring, R22)', () => {});
});

describe('no component test setup yet', () => {
  // R12: the data rule is tested in pure.test.ts (I2, candidateAncestorId). GhostLine now prints "status.local" with the
  // line number; rendering it needs jsdom + React Testing Library, which the repository does not have. E2E covers
  // the unverified chain in demo.spec.ts ("Local step · unverified line 14" in the line statuses).
  it.skip('I2 GhostLine renders the "local step · unverified line N" label for such a candidate (R12, component render)', () => {});
});
