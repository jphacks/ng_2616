import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Line, Notebook } from '@mn/contracts';
import { interruptPending, patchPending, type Command, type Snapshot } from '../../src/core/history/history';
import { contextLinesFor, hasUnresolvedWrong, parentFor } from '../../src/core/notebook/model';

const line = (id: string, state: Line['state'], extra: Partial<Line> = {}): Line => ({ id, version: 1, source: 'user', role: 'step', state, ink: [], segments: [], ...extra });
const snap = (lines: Line[]): Snapshot => ({ lines, recoveries: [], activeLineId: null });

describe('history', () => {
  it('patches a settled result into every snapshot that still holds the pending line', () => {
    const draft = line('L1', 'DRAFT');
    const pending = { ...draft, version: 2, state: 'RECOGNIZING' as const };
    const settled = { ...draft, version: 4, state: 'SETTLED' as const };
    const cmds: Command[] = [
      { type: 'CONFIRM_LINE', before: snap([draft]), after: snap([pending]) },
      { type: 'ADD_STROKE', before: snap([pending, line('L2', 'DRAFT')]), after: snap([pending, line('L2', 'DRAFT')]) },
    ];
    const patched = patchPending(cmds, settled);
    assert.equal(patched[0]!.before.lines[0]!.state, 'DRAFT', 'the confirm command still undoes to ink');
    assert.equal(patched[0]!.after.lines[0]!.state, 'SETTLED', 'redo restores the result without resubmission');
    assert.equal(patched[1]!.before.lines[0]!.state, 'SETTLED', 'later commands never resurrect the pending line');
  });

  it('turns unfinished work into an explicit retry state on redo', () => {
    const s = interruptPending(snap([line('L1', 'RECOGNIZING'), line('L2', 'SETTLED')]));
    assert.equal(s.lines[0]!.state, 'RECOGNIZE_FAILED');
    assert.equal(s.lines[0]!.failure?.code, 'INTERRUPTED');
    assert.equal(s.lines[1]!.state, 'SETTLED');
  });
});

describe('notebook model', () => {
  const proof = (status: 'ok' | 'wrong') => ({
    status,
    conditions: [],
    evidence: [],
    hints: [],
    segment_results: [],
    depends_on: [],
    depends_on_unverified: false,
    unverified_ancestors: [],
    input_hash: `sha256:${'0'.repeat(64)}` as const,
    mock: false,
    cas: { version: 'v', rules_version: '2.0.0' as const, elapsed_ms: 1, timed_out: false },
  });
  const math = [{ type: 'math' as const, expr: 'x', notation: 'plain' as const, latex: 'x' }];
  const nb = (lines: Line[]): Notebook => ({ schema_version: '2.2.0', id: '00000000-0000-4000-8000-000000000000', title: 't', mode: 'live', domain: 'Reals', lines, recoveries: [] });

  it('checks a revision against its source parent, never against the wrong source', () => {
    const a = line('A', 'SETTLED', { segments: math, verified: { verification_id: '1', input_hash: `sha256:${'0'.repeat(64)}`, proof: proof('ok') } });
    const w = line('W', 'SETTLED', { segments: math, verified: { verification_id: '2', input_hash: `sha256:${'0'.repeat(64)}`, proof: proof('wrong') } });
    const r = line('R', 'DRAFT', { revision_of: 'W' });
    const n = nb([a, w, r]);
    assert.deepEqual(contextLinesFor(n, 'R').map((l) => l.id), ['A']);
    assert.equal(parentFor(n, 'R')?.id, 'A');
    assert.equal(hasUnresolvedWrong(n), true);
    assert.equal(hasUnresolvedWrong(nb([a, { ...w, state: 'SUPERSEDED' }])), false);
  });
});
