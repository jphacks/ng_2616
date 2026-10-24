import type { Line, Notebook } from '@mn/contracts';
import { anyPending, canContinueFrom, hasUnresolvedWrong, lastSettledMath, proofOf } from '@/core/notebook/model';

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
}

const BUSY: ReadonlySet<CandidateStateName> = new Set(['GENERATING', 'VERIFYING', 'READY', 'HELD']);

export function suggestBlockerOf({ notebook: nb, casReady, candidate, activeLine }: BlockerInput): SuggestBlocker | null {
  if (!nb) return 'none';
  if (!casReady) return 'cas';
  if (anyPending(nb)) return 'pending';
  if (hasUnresolvedWrong(nb)) return 'wrong';
  const last = lastSettledMath(nb);
  if (!last) return 'empty';
  const incomplete = proofOf(last)?.reason === 'INCOMPLETE';
  if (!incomplete && !canContinueFrom(last)) return 'cannot-continue';
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
