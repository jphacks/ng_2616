import {
  hashOf,
  leanOf,
  routeOf,
  theoremOf,
  toInputSegments,
  type Hash,
  type LeanCheckInput,
  type LeanCheckLine,
  type Line,
  type Notebook,
  type UiLang,
} from '@mn/contracts';
import { declaredFunctions } from '@mn/contracts';
import { contextLinesFor, findLine, hasMath, isActive, isGiven, proofOf } from '@/core/notebook/model';

/** The `lean` feature (S-05, ADR 0008); the server answers "unavailable" when no worker is configured. */
export function leanEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_ENABLED_FEATURES ?? '').split(',').some((f) => f.trim() === 'lean');
}

/** A notebook proves something once it has a Lean theorem or the model has sent a line to Lean. */
export function isProofNotebook(nb: Notebook): boolean {
  return !!theoremOf(nb) || nb.lines.some((l) => isActive(l) && l.state === 'SETTLED' && routeOf(l) === 'lean');
}

/** CAS answers that mean "this is not algebra I can read": in a proof, Lean takes the line instead. */
const CAS_CANNOT_READ = new Set(['UNPARSED', 'UNSUPPORTED', 'TEXT_ONLY']);

/**
 * Whether a settled line goes to Lean: the model routed it there, or (in a proof) the CAS could
 * not read a line the model thought was algebra. Given lines state the theorem and filler is skipped.
 */
export function needsLean(nb: Notebook, line: Line): boolean {
  if (!leanEnabled() || line.state !== 'SETTLED' || !isActive(line) || isGiven(line)) return false;
  const route = routeOf(line);
  if (route === 'lean') return true;
  if (route === 'none') return false;
  return isProofNotebook(nb) && CAS_CANNOT_READ.has(proofOf(line)?.reason ?? '') && line.segments.length > 0;
}

export function givenLines(nb: Notebook): Line[] {
  return nb.lines.filter((l) => isActive(l) && l.state === 'SETTLED' && isGiven(l));
}

/** What the theorem was formalized from: the given lines' mathematical content. */
export function givenHash(lines: readonly Line[]): Hash {
  return hashOf(lines.filter((l) => isGiven(l) && l.state === 'SETTLED').map((l) => toInputSegments(l.segments)));
}

/** The proof so far: settled lines above the target that are not given and not filler, then the target. */
export function proofLines(nb: Notebook, target: Line): Line[] {
  const before = contextLinesFor(nb, target.id).filter((l) => !isGiven(l) && routeOf(l) !== 'none' && l.segments.length > 0);
  return [...before, target];
}

function checkLine(l: Line): LeanCheckLine {
  const tactic = leanOf(l)?.tactic;
  return { id: l.id, route: routeOf(l), segments: l.segments, ...(tactic !== undefined ? { tactic } : {}) };
}

/** Request body for checking `target` (a line of the notebook, or a suggestion placed after the lines). */
export function leanInput(nb: Notebook, target: Line, lang: UiLang, opts: { candidate?: boolean; retranslate?: boolean } = {}): LeanCheckInput {
  const given = givenLines(nb);
  const lines = proofLines(nb, target).map(checkLine);
  // the target is translated afresh: its own earlier translation is what is being checked again
  const last = lines[lines.length - 1]!;
  if (opts.retranslate || opts.candidate) delete last.tactic;
  const theorem = theoremOf(nb);
  return {
    ...(theorem ? { theorem } : {}),
    given: given.slice(-32).map((g) => ({ id: g.id, segments: g.segments })),
    given_hash: givenHash(nb.lines),
    lines: lines.slice(-64),
    target_line_id: target.id,
    functions: declaredFunctions(nb.lines).slice(0, 16),
    ...(opts.candidate ? { candidate: true } : {}),
    ui_lang: lang,
  };
}

/** What a Lean verdict depends on: the problem and every proof line up to the target (not their tactics). */
export function leanContextHash(input: Pick<LeanCheckInput, 'given_hash' | 'lines'>): Hash {
  return hashOf({ given: input.given_hash, lines: input.lines.map((l) => [l.id, l.route, toInputSegments(l.segments)]) });
}

/** The line a proof-mode suggestion continues from: the last settled proof line, words or formulas. */
export function lastProofLine(nb: Notebook): Line | undefined {
  for (let i = nb.lines.length - 1; i >= 0; i--) {
    const l = nb.lines[i]!;
    if (isActive(l) && l.state === 'SETTLED' && !isGiven(l) && routeOf(l) !== 'none' && (hasMath(l) || !!leanOf(l)?.proof)) return l;
  }
  return undefined;
}

/** A finished proof has nothing left to suggest; anything else Lean saw can be continued. */
export function leanContinuable(line: Line): boolean | undefined {
  const lean = leanOf(line);
  if (!lean?.proof) return undefined;
  return lean.proof !== 'proved';
}

export function leanLineOf(nb: Notebook, id: string) {
  const l = findLine(nb, id);
  return l ? leanOf(l) : undefined;
}
