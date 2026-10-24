import type { CheckerFeedback, Proof } from '@mn/contracts';

/** Model calls per suggestion request; each one after the first carries the CAS results so far. */
export const SUGGEST_ATTEMPTS = 3;

/** One model call plus its CAS check. */
export type Attempt<C> =
  | { kind: 'ready'; candidate: C } // verified, assumption or unverified: shown (unverified needs a second confirmation)
  | { kind: 'wrong'; hash: string; feedback: CheckerFeedback } // never shown, retried
  | { kind: 'none' } // the model (or a server guard) returned nothing
  | { kind: 'stale' }; // the context changed or the CAS went away: stop silently

export type AttemptsResult<C> = { kind: 'show'; candidate: C } | { kind: 'none'; rejected: number } | { kind: 'stale' };

/** CAS self-verification loop: a wrong suggestion is retried with the checker's feedback, up to `max` calls. */
export async function runAttempts<C>(max: number, attempt: (feedback: CheckerFeedback[], tried: string[]) => Promise<Attempt<C>>): Promise<AttemptsResult<C>> {
  const feedback: CheckerFeedback[] = [];
  const tried: string[] = [];
  for (let i = 0; i < max; i++) {
    const out = await attempt([...feedback], [...tried]);
    if (out.kind === 'stale') return out;
    if (out.kind === 'ready') return { kind: 'show', candidate: out.candidate };
    if (out.kind === 'none') break;
    feedback.push(out.feedback);
    tried.push(out.hash);
  }
  return { kind: 'none', rejected: feedback.length };
}

/** What the model is told about a wrong attempt: the CAS reason code and evidence summaries. */
export function checkerFeedback(latex: string, proof: Proof): CheckerFeedback {
  const summaries = [...proof.evidence, ...proof.segment_results.flatMap((r) => r.evidence)].map((ev) => ev.summary.slice(0, 500));
  return {
    latex: latex.slice(0, 4000),
    ...(proof.reason ? { reason: proof.reason.slice(0, 64) } : {}),
    evidence: [...new Set(summaries)].slice(0, 3),
  };
}
