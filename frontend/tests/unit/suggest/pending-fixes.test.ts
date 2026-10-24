import { describe, it } from 'node:test';

// What is still not tested, and why. Everything that needs only the engine, the store and fake CAS/api now lives in
// engine-suggest.test.ts, engine-held.test.ts and engine-adopt.test.ts (NotebookEngine takes fakes since eb59d8f).

describe('no component test setup yet', () => {
  // R12: the data rule is tested in pure.test.ts (I2, candidateAncestorId). GhostLine now prints "status.local" with the
  // line number; rendering it needs jsdom + React Testing Library, which the repository does not have. E2E covers
  // the unverified chain in demo.spec.ts ("Local step · unverified line 14" in the line statuses).
  it.skip('I2 GhostLine renders the "local step · unverified line N" label for such a candidate (R12, component render)', () => {});
});
