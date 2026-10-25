import 'server-only';
import {
  graphFromWire,
  hashOf,
  toInputSegments,
  type CandidateDraftResult,
  type CheckerRoute,
  type GraphWire,
  type MathJSON,
  type Role,
  type Segment,
  type SuggestInput,
} from '@mn/contracts';
import { printSegmentLatex } from '@mn/contracts/ir';
import { candidateHash, lineHash, proofCandidateHash, proofLineHash } from '@/core/candidates/hash';

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
export function finalizeCandidate(input: SuggestInput, segments: Segment[], role: Role, mock: boolean, route?: CheckerRoute): CandidateDraftResult {
  // a proof step may be words only: Lean, not the CAS, checks it (ADR 0008)
  if (route !== 'lean' && !segments.some((s) => s.type === 'math')) return none('PROSE_ONLY', mock);
  if (!segments.length) return none('PROSE_ONLY', mock);
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
  const sameLine = route === 'lean' ? proofLineHash : lineHash;
  const candidateLineHash = sameLine(inputSegs);
  if (input.context.lines.some((l) => sameLine(l.segments) === candidateLineHash)) return none('DUPLICATE', mock);
  const contentHash = route === 'lean' ? proofCandidateHash(input.mode, [inputSegs]) : candidateHash(input.mode, [inputSegs]);
  if (input.rejected_hashes.includes(contentHash)) return none('REJECTED_BEFORE', mock);
  return {
    state: 'GENERATED',
    mock,
    candidate: {
      id: crypto.randomUUID(),
      mode: input.mode,
      content_hash: contentHash,
      lines: [{ target: { id: input.target_line_id, role, segments: inputSegs }, segments: segs, ...(route ? { route } : {}) }],
    },
  };
}

/**
 * A GRAPH candidate: one text-role line whose words are the graph's title and whose picture is the
 * parsed spec. `detail` says which formula the parser refused, for the model's second try.
 */
export function graphCandidate(input: SuggestInput, wire: GraphWire, mock: boolean): CandidateDraftResult & { detail?: string } {
  const parsed = graphFromWire(wire, { functions: input.context.functions });
  if (!parsed.ok) return { ...none('IR_INVALID', mock), detail: parsed.message };
  const title = parsed.spec.title || (input.ui_lang === 'ja' ? 'グラフ' : 'Graph');
  const segments: Segment[] = [{ type: 'text', text: title }];
  const contentHash = hashOf({ mode: 'GRAPH', graph: parsed.spec });
  if (input.rejected_hashes.includes(contentHash)) return none('REJECTED_BEFORE', mock);
  return {
    state: 'GENERATED',
    mock,
    candidate: {
      id: crypto.randomUUID(),
      mode: 'GRAPH',
      content_hash: contentHash,
      lines: [{ target: { id: input.target_line_id, role: 'text', segments: toInputSegments(segments) }, segments, graph: { ...parsed.spec, title } }],
    },
  };
}
