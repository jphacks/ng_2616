import type { Line, Notebook } from '@mn/contracts';
import { isProofNotebook, lastProofLine, leanContinuable, leanEnabled } from '@/core/lean/route';
import { anyPending, canContinueFrom, hasMath, hasUnresolvedWrong, isActive, isGiven, isGraphLine, isGraphRequest, lastSettledMath, proofOf } from '@/core/notebook/model';

export type CandidateStateName = 'GENERATING' | 'VERIFYING' | 'READY' | 'HELD' | 'NONE' | 'ADOPTED' | 'REJECTED' | 'STALE';

/** Why a suggestion cannot start now; null means it can (same rules as NotebookEngine.suggestBlocker). */
export type SuggestBlocker = 'none' | 'hint-mode' | 'assist-off' | 'cas' | 'pending' | 'wrong' | 'empty' | 'cannot-continue' | 'busy' | 'writing';

/**
 * Assist mode (spec §14.2): in hint mode no completion is offered; the default is complete. 'off' is not in the
 * spec: no assistance at all, so neither completion nor the recovery hints (see hintsAllowedIn) are offered.
 */
export type AssistMode = 'hint' | 'complete' | 'off';

/** Whether the step-by-step hints (hint 1 and 2 on a wrong line) may be shown. Evidence is not a hint and stays. */
export const hintsAllowedIn = (mode?: AssistMode): boolean => mode !== 'off';

export interface BlockerInput {
  notebook: Notebook | null;
  casReady: boolean;
  /** state of the current candidate, if any */
  candidate: CandidateStateName | null;
  /** the line the student is writing on */
  activeLine: Line | undefined;
  /** S-02 assist mode; 'hint' hides completion. Absent or 'complete': completion as usual (spec §14.2) */
  assistMode?: AssistMode;
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

/**
 * The line asking for a graph that is still unanswered: the last settled line, when it is a graph
 * request and no graph follows it. A request is answered before anything else is suggested.
 */
export function graphAsk(nb: Notebook): Line | undefined {
  for (let i = nb.lines.length - 1; i >= 0; i--) {
    const l = nb.lines[i]!;
    if (!isActive(l) || l.state === 'DRAFT') continue;
    if (isGraphLine(l)) return undefined;
    return l.state === 'SETTLED' && isGraphRequest(l) ? l : undefined;
  }
  return undefined;
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

export function suggestBlockerOf({ notebook: nb, casReady, candidate, activeLine, assistMode, leanPending }: BlockerInput): SuggestBlocker | null {
  if (!nb) return 'none';
  if (assistMode === 'hint') return 'hint-mode';
  if (assistMode === 'off') return 'assist-off';
  if (!casReady) return 'cas';
  if (anyPending(nb) || leanPending) return 'pending';
  if (hasUnresolvedWrong(nb)) return 'wrong';
  // a graph request is answered even when it holds no formula and the CAS gave it no verdict
  if (!graphAsk(nb)) {
    const last = suggestBaseLine(nb);
    if (!last) return 'empty';
    const incomplete = proofOf(last)?.reason === 'INCOMPLETE';
    if (!incomplete && !continuable(last)) return 'cannot-continue';
  }
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
    case 'hint-mode':
      return 'toast.suggestHintMode';
    case 'assist-off':
      return 'toast.suggestAssistOff';
    case 'none':
      return null;
  }
}
