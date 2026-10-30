import 'server-only';
import {
  hashOf,
  segmentsFromSource,
  toInputSegments,
  type CandidateDraftResult,
  type GraphWire,
  type RecognizeInput,
  type RecognizeResult,
  type SuggestInput,
} from '@mn/contracts';
import { SCHRODINGER_FUNCTIONS, SCHRODINGER_SCRIPT } from '@mn/contracts/fixtures';
import type { ParseOptions } from '@mn/contracts/ir';
import { finalizeCandidate, graphCandidate } from './candidate';

export const DEMO_SCRIPT_ID = 'schrodinger-v1';

const OPTS: ParseOptions = { functions: SCHRODINGER_FUNCTIONS };
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });

/** The student's request once the script is done: a graph of the first stationary states. */
const GRAPH_REQUEST = 'Plot $\\psi_n(x)$ for n = 1, 2, 3';

/**
 * Without an LLM key: whatever is drawn on the n-th user line maps to the n-th scripted user line.
 * A line written after the script's last one asks for a graph of the solution.
 */
export function scriptedRecognition(input: RecognizeInput): RecognizeResult {
  const userSteps = SCHRODINGER_SCRIPT.filter((s) => s.who === 'user');
  const index = input.user_line_index ?? 0;
  if (index >= userSteps.length) {
    return { segments: segmentsFromSource(GRAPH_REQUEST, OPTS), unreadable: false, mock: true, transcription: GRAPH_REQUEST, route: 'none', graph_request: true };
  }
  const step = userSteps[index]!;
  return { segments: segmentsFromSource(step.src, OPTS), unreadable: false, mock: true, transcription: step.src };
}

/** The scripted answer to GRAPH_REQUEST: ψ_n(x) = √(2/L) sin(nπx/L) in a box of width 1. */
const SCRIPTED_GRAPH: GraphWire = {
  has_graph: true,
  kind: '2d',
  title: 'Stationary states ψₙ(x) in a box of width L = 1',
  x_label: '$x$',
  y_label: '$\\psi_n(x)$',
  x_range: [0, 1],
  constants: [{ name: 'L', value: 1 }],
  series: [1, 2, 3].map((n) => ({ type: 'function' as const, label: `$n = ${n}$`, y: `\\sqrt{\\frac{2}{L}}\\sin\\left(\\frac{${n}\\pi x}{L}\\right)` })),
};

/**
 * Scripted AI for the demo notebook: the first AI step not yet in the notebook, after the
 * student's own lines. The deliberately wrong step comes first; once the checker rejects it
 * (its hash arrives in rejected_hashes) the correct one follows. The real CAS still checks all.
 */
export async function scriptedSuggestion(input: SuggestInput, signal: AbortSignal): Promise<CandidateDraftResult> {
  if (input.mode === 'GRAPH') {
    await sleep(900, signal);
    return graphCandidate(input, SCRIPTED_GRAPH, true);
  }
  const lineHashes = new Set(input.context.lines.map((l) => hashOf(toInputSegments(l.segments))));
  // the student's own lines: a template's given lines are not part of the script
  const userLines = input.context.lines.filter((l) => l.source === 'user' && l.role !== 'premise' && l.segments.some((s) => s.type === 'math')).length;
  let userSeen = 0;
  for (const [index, step] of SCHRODINGER_SCRIPT.entries()) {
    if (step.who === 'user') {
      userSeen += 1;
      if (userLines < userSeen) return { state: 'NONE', reason: 'WAITING_FOR_STUDENT', mock: true };
      continue;
    }
    const segments = segmentsFromSource(step.src, OPTS);
    if (lineHashes.has(hashOf(toInputSegments(segments)))) continue;
    // the deliberately wrong step is offered once: never again after its correction is in the notebook
    const next = SCHRODINGER_SCRIPT[index + 1];
    if (step.rejected && next && lineHashes.has(hashOf(toInputSegments(segmentsFromSource(next.src, OPTS))))) continue;
    const result = finalizeCandidate({ ...input, mode: 'NEXT_STEP' }, segments, step.role, true);
    if (result.state === 'NONE') continue; // rejected before (the wrong step) → offer the next
    await sleep(800 + ((index * 137) % 800), signal);
    return result;
  }
  return { state: 'NONE', reason: 'SCRIPT_COMPLETE', mock: true };
}
