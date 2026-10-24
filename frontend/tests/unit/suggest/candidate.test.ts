import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MathJSON } from '@mn/contracts';
import { finalizeCandidate } from '../../../src/server/ai/direct/candidate';
import { segs, settled, suggestInput } from './fixtures';

// run with: npx tsx --test --conditions=react-server <file>   (candidate.ts imports 'server-only')

const A = settled('L1', '$\\frac{A^{2}L}{2} = 1$');
const rhsInput = (over = {}) => suggestInput({ lines: [A], mode: 'COMPLETE_RHS', based_on_line_id: 'L2', target_line_id: 'L2', lhs_expr: 'A', ...over });

describe('finalizeCandidate: COMPLETE_RHS keeps the left-hand side (R1)', () => {
  it('A1 accepts Equal(lhs, rhs) and targets the incomplete line', () => {
    const r = finalizeCandidate(rhsInput(), segs('A = \\sqrt{\\frac{2}{L}}'), 'step', false);
    assert.equal(r.state, 'GENERATED');
    const line = r.candidate!.lines[0]!;
    assert.equal(line.target.id, 'L2');
    assert.equal(line.segments.length, 1);
    const m = line.segments[0]!;
    assert.ok(m.type === 'math');
    assert.equal(m.notation, 'plain');
    assert.equal((m.expr as MathJSON[])[1], 'A');
  });

  it('A2 rebuilds Equal(lhs_expr, rhs) from a continuation and drops prose', () => {
    const r = finalizeCandidate(rhsInput(), segs('so $= \\sqrt{\\frac{2}{L}}$'), 'step', false);
    assert.equal(r.state, 'GENERATED');
    assert.equal(r.candidate!.lines[0]!.segments.length, 1);
    const m = r.candidate!.lines[0]!.segments[0]!;
    assert.ok(m.type === 'math');
    assert.equal(m.notation, 'plain');
    assert.equal((m.expr as MathJSON[])[0], 'Equal');
    assert.equal((m.expr as MathJSON[])[1], 'A');
  });

  it('A3 a changed or missing left-hand side is discarded, an empty right-hand side is incomplete', () => {
    assert.equal(finalizeCandidate(rhsInput(), segs('B = 2'), 'step', false).reason, 'LHS_CHANGED');
    assert.equal(finalizeCandidate(rhsInput(), segs('A^{2} = 2'), 'step', false).reason, 'LHS_CHANGED');
    const noLhs = suggestInput({ lines: [A], mode: 'COMPLETE_RHS', target_line_id: 'L2' });
    assert.equal(finalizeCandidate(noLhs, segs('A = 2'), 'step', false).reason, 'LHS_CHANGED');
    assert.equal(finalizeCandidate(rhsInput(), segs('A ='), 'step', false).reason, 'INCOMPLETE');
  });
});

describe('finalizeCandidate: discarding (R6a, R6b, R7, R22)', () => {
  it('A4 prose-only output is discarded', () => {
    const r = finalizeCandidate(suggestInput({ lines: [A] }), [{ type: 'text', text: 'try dividing' }], 'step', false);
    assert.deepEqual([r.state, r.reason], ['NONE', 'PROSE_ONLY']);
  });

  it('A5 an exact repeat of an existing line is a duplicate; an equivalent but different IR is not', () => {
    const lines = [settled('L1', '$x^{2} - 5x + 6$')];
    assert.equal(finalizeCandidate(suggestInput({ lines }), segs('x^{2} - 5x + 6'), 'step', false).reason, 'DUPLICATE');
    const reordered = finalizeCandidate(suggestInput({ lines }), segs('x^{2} + 6 - 5x'), 'step', false);
    assert.equal(reordered.state, 'GENERATED', 'equivalence is the purpose of a step, not a repeat');
  });

  it('A6 prose never makes a repeated formula new (R6b)', () => {
    const lines = [settled('L1', 'expand: $x^{2} - 5x + 6$')];
    const r = finalizeCandidate(suggestInput({ lines }), segs('then $x^{2} - 5x + 6$ again'), 'step', false);
    assert.equal(r.reason, 'DUPLICATE');
  });

  it('A6b notation matters: a continuation is not the plain line', () => {
    const lines = [settled('L1', '$x^{2} = 4$')];
    assert.equal(finalizeCandidate(suggestInput({ lines }), segs('= x^{2}'), 'step', false).state, 'GENERATED');
  });

  it('A7 a hash the student already rejected is not offered again', () => {
    const first = finalizeCandidate(suggestInput({ lines: [A] }), segs('2 A^{2} L = 4'), 'step', false);
    assert.equal(first.state, 'GENERATED');
    const again = finalizeCandidate(suggestInput({ lines: [A], rejected_hashes: [first.candidate!.content_hash] }), segs('2 A^{2} L = 4'), 'step', false);
    assert.deepEqual([again.state, again.reason], ['NONE', 'REJECTED_BEFORE']);
  });

  it('A7b a rejected formula comes back with new prose and is still rejected (R6b)', () => {
    const first = finalizeCandidate(suggestInput({ lines: [A] }), segs('2 A^{2} L = 4'), 'step', false);
    const reworded = finalizeCandidate(suggestInput({ lines: [A], rejected_hashes: [first.candidate!.content_hash] }), segs('multiply by 2: $2 A^{2} L = 4$'), 'step', false);
    assert.equal(reworded.reason, 'REJECTED_BEFORE');
  });
});

describe('candidate content_hash (R6b)', () => {
  const hash = (src: string, over = {}) => finalizeCandidate(suggestInput({ lines: [A], ...over }), segs(src), 'step', false).candidate!.content_hash;

  it('A8 is stable, depends on the mode and the formulas, and ignores prose', () => {
    assert.equal(hash('2 A^{2} L = 4'), hash('2 A^{2} L = 4'));
    assert.match(hash('2 A^{2} L = 4'), /^sha256:[0-9a-f]{64}$/);
    assert.equal(hash('2 A^{2} L = 4'), hash('so $2 A^{2} L = 4$'));
    assert.notEqual(hash('2 A^{2} L = 4'), hash('2 A^{2} L = 5'));
    const nextStep = hash('A = 2', { mode: 'NEXT_STEP' });
    const complete = hash('A = 2', { mode: 'COMPLETE_RHS', lhs_expr: 'A', target_line_id: 'L1' });
    assert.notEqual(nextStep, complete);
  });

  it('A9 the mock flag is carried through; ids are fresh while the hash is not', () => {
    const a = finalizeCandidate(suggestInput({ lines: [A] }), segs('A = 2'), 'step', true);
    const b = finalizeCandidate(suggestInput({ lines: [A] }), segs('A = 2'), 'step', true);
    assert.equal(a.mock, true);
    assert.notEqual(a.candidate!.id, b.candidate!.id);
    assert.equal(a.candidate!.content_hash, b.candidate!.content_hash);
  });
});
