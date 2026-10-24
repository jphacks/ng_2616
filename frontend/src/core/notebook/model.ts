import { declaredFunctions, reparseSegments, type Line, type Notebook, type Proof, type Status } from '@mn/contracts';
import { shortId } from '@/core/ids';

export const PENDING_STATES = new Set<Line['state']>(['RECOGNIZING', 'VERIFYING']);

export function newDraftLine(): Line {
  return { id: shortId('L'), version: 1, source: 'user', role: 'step', state: 'DRAFT', ink: [], segments: [] };
}

export const isActive = (l: Line) => l.state !== 'SUPERSEDED';
export const hasMath = (l: Line) => l.segments.some((s) => s.type === 'math');
export const proofOf = (l: Line): Proof | undefined => l.verified?.proof;
export const statusOf = (l: Line): Status | undefined => l.verified?.proof.status;
export const isSettledMath = (l: Line) => l.state === 'SETTLED' && hasMath(l);

export function lineIndex(nb: Notebook, id: string): number {
  return nb.lines.findIndex((l) => l.id === id);
}

export function findLine(nb: Notebook, id: string): Line | undefined {
  return nb.lines.find((l) => l.id === id);
}

/** 1-based number among visible (non-draft-empty) lines, for "line N" references. */
export function lineNumber(nb: Notebook, id: string): number | null {
  let n = 0;
  for (const l of nb.lines) {
    if (l.state === 'SUPERSEDED') continue;
    n += 1;
    if (l.id === id) return n;
  }
  return null;
}

/**
 * Lines that form a target's mathematical context: active, settled, earlier in the page.
 * A revision is checked against its source's context, never against the source itself.
 */
export function contextLinesFor(nb: Notebook, targetId: string): Line[] {
  const idx = lineIndex(nb, targetId);
  const target = nb.lines[idx];
  const exclude = new Set<string>();
  if (target?.revision_of) exclude.add(target.revision_of);
  return nb.lines.slice(0, idx < 0 ? nb.lines.length : idx).filter((l) => isActive(l) && l.state === 'SETTLED' && !exclude.has(l.id));
}

export function parentFor(nb: Notebook, targetId: string): Line | undefined {
  const target = findLine(nb, targetId);
  if (target?.revision_of) return parentFor(nb, target.revision_of);
  const ctx = contextLinesFor(nb, targetId).filter((l) => hasMath(l) && statusOf(l) !== 'wrong');
  return ctx[ctx.length - 1];
}

/** Any unresolved wrong line blocks every completion mode (spec §10). */
export function hasUnresolvedWrong(nb: Notebook): boolean {
  return nb.lines.some((l) => isActive(l) && l.state === 'SETTLED' && statusOf(l) === 'wrong') ||
    nb.recoveries.some((r) => r.phase === 'UNRESOLVED');
}

export function lastSettledMath(nb: Notebook): Line | undefined {
  for (let i = nb.lines.length - 1; i >= 0; i--) {
    const l = nb.lines[i]!;
    if (isActive(l) && isSettledMath(l)) return l;
  }
  return undefined;
}

export function anyPending(nb: Notebook): boolean {
  return nb.lines.some((l) => PENDING_STATES.has(l.state));
}

/** Reasons after which NEXT_STEP may still start (spec §11). */
const CONTINUABLE_UNKNOWN = new Set(['TIMEOUT', 'NO_EVIDENCE', 'NUM_ONLY', 'UNSUPPORTED', 'SUBSET_OF_SOLUTIONS', 'DOMAIN_CHANGED']);

export function canContinueFrom(l: Line): boolean {
  const p = proofOf(l);
  if (!p) return false;
  if (p.status === 'ok' || p.status === 'none') return true;
  return p.status === 'unknown' && CONTINUABLE_UNKNOWN.has(p.reason ?? '');
}

export function mathLatexOf(l: Line): string {
  return l.segments.map((s) => (s.type === 'math' ? s.latex : '')).filter(Boolean).join(',\\; ');
}

/**
 * Declarations hold for the whole page (v2.2): when the functions the lines declare change, every
 * line is read again with them. Returns the same array when nothing changes.
 */
export function withDeclarations(lines: Line[]): Line[] {
  const functions = declaredFunctions(lines);
  let changed = false;
  const out = lines.map((l) => {
    const segments = reparseSegments(l.segments, functions);
    if (segments === l.segments) return l;
    changed = true;
    return { ...l, version: l.version + 1, segments };
  });
  return changed ? out : lines;
}

/** Given lines state the problem: marked by the student, or a template's opening lines. */
export const isGiven = (l: Line) => l.role === 'premise';

export function emptyDraft(l: Line | undefined): boolean {
  return !!l && l.state === 'DRAFT' && l.ink.length === 0;
}
