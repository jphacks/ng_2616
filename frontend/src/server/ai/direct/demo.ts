import 'server-only';
import {
  hashOf,
  segmentsFromSource,
  toInputSegments,
  type CandidateDraftResult,
  type RecognizeInput,
  type RecognizeResult,
  type SuggestInput,
} from '@mn/contracts';
import { SCHRODINGER_FUNCTIONS, SCHRODINGER_SCRIPT } from '@mn/contracts/fixtures';
import type { ParseOptions } from '@mn/contracts/ir';
import { finalizeCandidate } from './candidate';

export const DEMO_SCRIPT_ID = 'schrodinger-v1';

const OPTS: ParseOptions = { functions: SCHRODINGER_FUNCTIONS };
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });

/** Without an LLM key: whatever is drawn on the n-th user line maps to the n-th scripted user line. */
export function scriptedRecognition(input: RecognizeInput): RecognizeResult {
  const userSteps = SCHRODINGER_SCRIPT.filter((s) => s.who === 'user');
  const step = userSteps[Math.min(input.user_line_index ?? 0, userSteps.length - 1)]!;
  return { segments: segmentsFromSource(step.src, OPTS), unreadable: false, mock: true, transcription: step.src };
}

/**
 * Scripted AI for the demo notebook: the first AI step not yet in the notebook, after the
 * student's own lines. The deliberately wrong step comes first; once the checker rejects it
 * (its hash arrives in rejected_hashes) the correct one follows. The real CAS still checks all.
 */
export async function scriptedSuggestion(input: SuggestInput, signal: AbortSignal): Promise<CandidateDraftResult> {
  const lineHashes = new Set(input.context.lines.map((l) => hashOf(toInputSegments(l.segments))));
  const userLines = input.context.lines.filter((l) => l.source === 'user' && l.segments.some((s) => s.type === 'math')).length;
  let userSeen = 0;
  for (const [index, step] of SCHRODINGER_SCRIPT.entries()) {
    if (step.who === 'user') {
      userSeen += 1;
      if (userLines < userSeen) return { state: 'NONE', reason: 'WAITING_FOR_STUDENT', mock: true };
      continue;
    }
    const segments = segmentsFromSource(step.src, OPTS);
    if (lineHashes.has(hashOf(toInputSegments(segments)))) continue;
    const result = finalizeCandidate({ ...input, mode: 'NEXT_STEP' }, segments, step.role, true);
    if (result.state === 'NONE') continue; // rejected before (the wrong step) → offer the next
    await sleep(800 + ((index * 137) % 800), signal);
    return result;
  }
  return { state: 'NONE', reason: 'SCRIPT_COMPLETE', mock: true };
}
