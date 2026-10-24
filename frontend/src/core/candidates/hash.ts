import { hashOf, type Hash, type InputSegment, type MathJSON, type Segment, type SuggestMode } from '@mn/contracts';

/** The part of a candidate line that identifies it: formulas (expr + notation) in order, prose ignored. */
export interface MathKey {
  expr: MathJSON;
  notation: 'plain' | 'continuation';
}

export function mathKey(segments: readonly (Segment | InputSegment)[]): MathKey[] {
  const out: MathKey[] = [];
  for (const s of segments) if (s.type === 'math') out.push({ expr: s.expr, notation: s.notation });
  return out;
}

/** Identity of one line for duplicate checks: exact IR and notation, no simplification (spec §11, §7.3). */
export function lineHash(segments: readonly (Segment | InputSegment)[]): Hash {
  return hashOf(mathKey(segments));
}

/** Candidate hash (spec §7.3): the mode and the candidate's IR/notation. Prose never changes it. */
export function candidateHash(mode: SuggestMode, lines: readonly (readonly (Segment | InputSegment)[])[]): Hash {
  return hashOf({ mode, lines: lines.map(mathKey) });
}
