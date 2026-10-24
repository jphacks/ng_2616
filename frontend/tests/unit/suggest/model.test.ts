import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anyPending, canContinueFrom, contextLinesFor, hasUnresolvedWrong, lastSettledMath, parentFor } from '../../../src/core/notebook/model';
import { line, notebook, settled } from './fixtures';

describe('model: canContinueFrom (R3)', () => {
  const can = (status: 'ok' | 'none' | 'wrong' | 'unknown', reason?: string) => canContinueFrom(settled('L1', '$x = 1$', status, reason));

  it('C1 ok and none continue; wrong never does', () => {
    assert.equal(can('ok'), true);
    assert.equal(can('none', 'PREMISE'), true);
    assert.equal(can('wrong'), false);
  });

  it('C1 unknown continues only for the listed reasons', () => {
    for (const r of ['TIMEOUT', 'NO_EVIDENCE', 'NUM_ONLY', 'UNSUPPORTED', 'SUBSET_OF_SOLUTIONS']) assert.equal(can('unknown', r), true, r);
    for (const r of ['UNREADABLE', 'INCOMPLETE', 'CAS_ERROR']) assert.equal(can('unknown', r), false, r);
  });

  // The spec (v2.0 §11) lists four reasons, v2.1 adds SUBSET_OF_SOLUTIONS. DOMAIN_CHANGED is in CONTINUABLE_UNKNOWN
  // without a source (NOTES R3, awaiting CAS owner). This pins the current behaviour; change it together with the answer.
  it('C1 pins the current, unexplained DOMAIN_CHANGED behaviour', () => {
    assert.equal(can('unknown', 'DOMAIN_CHANGED'), true);
  });

  it('a line without a verification result cannot continue', () => {
    assert.equal(canContinueFrom(line('L1', 'SETTLED')), false);
  });
});

describe('model: unresolved errors (R10)', () => {
  const ok = settled('A', '$x = 1$');
  const wrong = settled('W', '$x = 2$', 'wrong');

  it('C2 a wrong line or an UNRESOLVED recovery locks completion', () => {
    assert.equal(hasUnresolvedWrong(notebook([ok, wrong])), true);
    assert.equal(hasUnresolvedWrong(notebook([ok], [{ root_line_id: 'W', current_line_id: 'R', phase: 'UNRESOLVED', opened_at: {} }])), true);
    assert.equal(hasUnresolvedWrong(notebook([ok])), false);
  });

  it('C2 a superseded wrong line or a RECOVERED recovery does not', () => {
    assert.equal(hasUnresolvedWrong(notebook([ok, { ...wrong, state: 'SUPERSEDED' }])), false);
    assert.equal(hasUnresolvedWrong(notebook([ok], [{ root_line_id: 'W', current_line_id: 'R', phase: 'RECOVERED', opened_at: {} }])), false);
  });

  // v2.0 §11 also names "an unknown revision". hasUnresolvedWrong does not look at revision_of directly; it relies on
  // the engine marking the recovery UNRESOLVED. This documents that a bare unknown revision line alone is NOT detected.
  it('C2 a revision line that is only unknown is detected through its recovery, not by itself', () => {
    const rev = settled('R', '$x = 3$', 'unknown', 'NO_EVIDENCE', { revision_of: 'W', recovery_root_id: 'W' });
    assert.equal(hasUnresolvedWrong(notebook([ok, { ...wrong, state: 'SUPERSEDED' }, rev])), false);
    const rec = [{ root_line_id: 'W', current_line_id: 'R', phase: 'UNRESOLVED' as const, opened_at: {} }];
    assert.equal(hasUnresolvedWrong(notebook([ok, { ...wrong, state: 'SUPERSEDED' }, rev], rec)), true);
  });
});

describe('model: lines that matter to a suggestion', () => {
  it('C3 lastSettledMath skips drafts, superseded lines and prose', () => {
    const a = settled('A', '$x = 1$');
    const prose = settled('P', '$x = 1$', 'none', undefined, { segments: [{ type: 'text', text: 'a note' }] });
    const old = { ...settled('O', '$x = 5$'), state: 'SUPERSEDED' as const };
    assert.equal(lastSettledMath(notebook([a, prose, old, line('D', 'DRAFT')]))?.id, 'A');
    assert.equal(lastSettledMath(notebook([line('D', 'DRAFT')])), undefined);
  });

  it('C3 contextLinesFor excludes a revision’s source and parentFor skips wrong lines', () => {
    const a = settled('A', '$x = 1$');
    const w = settled('W', '$x = 2$', 'wrong');
    const draft = line('R', 'DRAFT', { revision_of: 'W' });
    const nb = notebook([a, w, draft]);
    assert.deepEqual(contextLinesFor(nb, 'R').map((l) => l.id), ['A']);
    assert.equal(parentFor(nb, 'R')?.id, 'A');
  });

  it('C3 anyPending is true while a line is recognizing or verifying', () => {
    assert.equal(anyPending(notebook([settled('A', '$x = 1$')])), false);
    assert.equal(anyPending(notebook([settled('A', '$x = 1$'), line('B', 'RECOGNIZING')])), true);
    assert.equal(anyPending(notebook([line('B', 'VERIFYING')])), true);
  });
});
