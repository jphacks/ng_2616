import 'server-only';
import { toInputSegments, type CandidateDraftResult, type MathJSON, type Role, type Segment, type SuggestInput } from '@mn/contracts';
import { printSegmentLatex } from '@mn/contracts/ir';
import { candidateHash, lineHash } from '@/core/candidates/hash';

const none = (reason: string, mock: boolean): CandidateDraftResult => ({ state: 'NONE', reason, mock });

function sameIr(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Server-side candidate guards (spec §11): discard prose-only output, a changed LHS,
 * and exact repeats of existing or rejected lines. A repeat means the same formulas (IR and
 * notation, in order); prose never makes a candidate new, and CAS-equivalence is not a repeat.
 * The result is still unverified; the browser CAS decides what may be shown.
 */
export function finalizeCandidate(input: SuggestInput, segments: Segment[], role: Role, mock: boolean): CandidateDraftResult {
  if (!segments.some((s) => s.type === 'math')) return none('PROSE_ONLY', mock);
  let segs = segments;
  if (input.mode === 'COMPLETE_RHS') {
    const m = segs.find((s) => s.type === 'math');
    if (!m || m.type !== 'math' || input.lhs_expr === undefined) return none('LHS_CHANGED', mock);
    let rhs: MathJSON;
    if (m.notation === 'continuation') rhs = m.expr;
    else if (Array.isArray(m.expr) && m.expr[0] === 'Equal' && sameIr(m.expr[1], input.lhs_expr)) rhs = m.expr[2] as MathJSON;
    else return none('LHS_CHANGED', mock);
    if (rhs === null) return none('INCOMPLETE', mock);
    const expr: MathJSON = ['Equal', input.lhs_expr, rhs];
    segs = [{ type: 'math', expr, notation: 'plain', latex: printSegmentLatex(expr, 'plain') }];
  }
  const inputSegs = toInputSegments(segs);
  const candidateLineHash = lineHash(inputSegs);
  if (input.context.lines.some((l) => lineHash(l.segments) === candidateLineHash)) return none('DUPLICATE', mock);
  const contentHash = candidateHash(input.mode, [inputSegs]);
  if (input.rejected_hashes.includes(contentHash)) return none('REJECTED_BEFORE', mock);
  return {
    state: 'GENERATED',
    mock,
    candidate: {
      id: crypto.randomUUID(),
      mode: input.mode,
      content_hash: contentHash,
      lines: [{ target: { id: input.target_line_id, role, segments: inputSegs }, segments: segs }],
    },
  };
}
