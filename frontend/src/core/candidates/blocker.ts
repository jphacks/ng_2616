import type { Line, Notebook } from '@mn/contracts';
import { isProofNotebook, lastProofLine, leanContinuable, leanEnabled } from '@/core/lean/route';
import { anyPending, canContinueFrom, hasMath, hasUnresolvedWrong, isGiven, lastSettledMath, proofOf } from '@/core/notebook/model';

export type CandidateStateName = 'GENERATING' | 'VERIFYING' | 'READY' | 'HELD' | 'NONE' | 'ADOPTED' | 'REJECTED' | 'STALE';

/** Why a suggestion cannot start now; null means it can (same rules as NotebookEngine.suggestBlocker). */
export type SuggestBlocker = 'none' | 'cas' | 'pending' | 'wrong' | 'empty' | 'cannot-continue' | 'busy' | 'writing';

export interface BlockerInput {
  notebook: Notebook | null;
  casReady: boolean;
  /** state of the current candidate, if any */
  candidate: CandidateStateName | null;
  /** the line the student is writing on */
  activeLine: Line | undefined;
  /** a Lean check is still running for some line (ADR 0008) */
  leanPending?: boolean;
}

const BUSY: ReadonlySet<CandidateStateName> = new Set(['GENERATING', 'VERIFYING', 'READY', 'HELD']);

/**
 * The line a suggestion continues from: the last settled formula, or in a proof (ADR 0008) the last
 * proof line, which may be words only.
 */
export function suggestBaseLine(nb: Notebook): Line | undefined {
  if (leanEnabled() && isProofNotebook(nb)) return lastProofLine(nb) ?? lastSettledMath(nb);
  return lastSettledMath(nb);
}

/** The student has written a line of their own (a template's given lines alone do not count). */
export function hasOwnLine(nb: Notebook): boolean {
  const proof = leanEnabled() && isProofNotebook(nb);
  return nb.lines.some((l) => l.state === 'SETTLED' && !isGiven(l) && (hasMath(l) || (proof && l.segments.length > 0)));
}

/** Lean's verdict decides for a line Lean checked; otherwise the CAS rules of spec §11. */
export function continuable(last: Line): boolean {
  return leanContinuable(last) ?? canContinueFrom(last);
}

export function suggestBlockerOf({ notebook: nb, casReady, candidate, activeLine, leanPending }: BlockerInput): SuggestBlocker | null {
  if (!nb) return 'none';
  if (!casReady) return 'cas';
  if (anyPending(nb) || leanPending) return 'pending';
  if (hasUnresolvedWrong(nb)) return 'wrong';
  const last = suggestBaseLine(nb);
  if (!last) return 'empty';
  const incomplete = proofOf(last)?.reason === 'INCOMPLETE';
  if (!incomplete && !continuable(last)) return 'cannot-continue';
  if (candidate && BUSY.has(candidate)) return 'busy';
  if (activeLine && activeLine.state === 'DRAFT' && activeLine.ink.length > 0) return 'writing';
  return null;
}

/** Same selection as requestSuggestion: an unfinished "L =" line completes its right-hand side, anything else asks for the next step. */
export function suggestModeOf(last: Line): 'COMPLETE_RHS' | 'NEXT_STEP' {
  const math = last.segments.find((s) => s.type === 'math');
  const incomplete =
    proofOf(last)?.reason === 'INCOMPLETE' && math?.type === 'math' && Array.isArray(math.expr) && math.expr[0] === 'Equal';
  return incomplete ? 'COMPLETE_RHS' : 'NEXT_STEP';
}

/**
 * The short message a manual press of the suggest button gets when nothing starts, or null when the
 * reason is already obvious on screen. `candidate` is the state of the current candidate, if any.
 * Messages are keys of src/i18n; the toast.suggest* keys are final wording (NOTES, ③が決めたこと).
 */
export function blockerToastKey(blocker: SuggestBlocker, candidate: CandidateStateName | null): string | null {
  switch (blocker) {
    case 'wrong':
      return 'toast.fixWrongFirst';
    case 'cas':
      return 'toast.casLoading';
    case 'empty':
      return 'toast.writeFirst';
    case 'writing':
      return 'toast.confirmFirst';
    case 'pending':
      return 'toast.suggestPending';
    case 'cannot-continue':
      return 'toast.suggestCannotContinue';
    case 'busy':
      return candidate === 'HELD' ? 'toast.suggestHeld' : 'toast.suggestBusy';
    case 'none':
      return null;
  }
}
