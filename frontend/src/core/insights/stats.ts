import { hashOf, type Line, type Notebook, type NotebookStats } from '@mn/contracts';
import { hasMath, isActive, isGiven, statusOf } from '@/core/notebook/model';

/** Lean's verdict on a line, as far as the counts need it (Line.extensions.lean, ADR 0008). */
type LeanMark = { step?: string; proof?: string; scope?: string };
const leanOf = (l: Line) => l.extensions?.lean as LeanMark | undefined;

const settled = (l: Line) => isActive(l) && l.state === 'SETTLED' && l.segments.length > 0;
const lineText = (l: Line) => l.segments.map((s) => (s.type === 'text' ? s.text : s.latex)).join('  ');

/** The student's own work: settled lines with content, without the given lines of the problem. */
export function workLines(nb: Notebook): Line[] {
  return nb.lines.filter((l) => settled(l) && !isGiven(l));
}

export function notebookStats(nb: Notebook): NotebookStats {
  const work = workLines(nb);
  const ai = work.filter((l) => l.ai_origin || l.source === 'ai');
  const ai_modes = { COMPLETE_RHS: 0, NEXT_STEP: 0, BRIDGE: 0 };
  for (const l of ai) if (l.ai_origin) ai_modes[l.ai_origin.mode] += 1;
  const checked = { ok: 0, wrong: 0, unknown: 0 };
  for (const l of work) {
    // a proof step's CAS status only says "not algebra": Lean's verdict counts for it instead
    if (!hasMath(l) || l.extensions?.route === 'lean') continue;
    const s = statusOf(l);
    if (s === 'ok' || s === 'wrong' || s === 'unknown') checked[s] += 1;
  }
  const active = nb.lines.filter(isActive);
  const lean = active.map(leanOf);
  const theoremProved = lean.some((m) => m?.proof === 'proved' && m.scope !== 'line');
  return {
    lines: work.length,
    ai_lines: ai.length,
    ai_modes,
    checked,
    mistakes: nb.recoveries.length,
    fixed: nb.recoveries.filter((r) => r.phase === 'RECOVERED').length,
    hints: nb.recoveries.reduce((n, r) => n + (r.opened_at.hint1 ? 1 : 0) + (r.opened_at.hint2 ? 1 : 0), 0),
    lean_steps: lean.filter((m) => m?.step === 'ok').length,
    lean_proofs: (theoremProved ? 1 : 0) + lean.filter((m) => m?.scope === 'line' && m.proof === 'proved').length,
    graphs: active.filter((l) => l.extensions?.graph !== undefined).length,
  };
}

const TAG_TEXT_MAX = 8000;

/** What the tags are read from: every settled line, the problem's given lines first as written. */
export function tagText(nb: Notebook): string {
  return nb.lines.filter(settled).map(lineText).join('\n').slice(0, TAG_TEXT_MAX);
}

/** How many lines the tags are read from. */
export function tagLines(nb: Notebook): number {
  return nb.lines.filter(settled).length;
}

/** Changes whenever the text the tags were read from changes. */
export function tagKey(nb: Notebook): string {
  return hashOf({ title: nb.title, text: tagText(nb) });
}

/** A notebook says enough about its subject once it has two settled lines. */
export const TAG_MIN_LINES = 2;
/** Tags are read again after this many lines were added or removed, */
export const RETAG_LINE_DELTA = 3;
/** or after this long when the content changed in place. */
export const RETAG_AFTER_MS = 6 * 60 * 60 * 1000;

export interface TagState {
  tags_hash: string | null;
  tags_lines: number;
  tagged_at: string | null;
}

/** Whether a save should ask the model for tags again (it is one LLM call per notebook). */
export function shouldRetag(prev: TagState, key: string, lines: number, now: number): boolean {
  if (lines < TAG_MIN_LINES || key === prev.tags_hash) return false;
  if (!prev.tagged_at) return true;
  return Math.abs(lines - prev.tags_lines) >= RETAG_LINE_DELTA || now - Date.parse(prev.tagged_at) >= RETAG_AFTER_MS;
}

/** The local calendar day, as the database's date type writes it. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Days with at least one save, kept for a little over a year. */
export const ACTIVE_DAYS_KEPT = 400;

export function withDay(days: readonly string[], day: string): string[] {
  if (days.includes(day)) return [...days];
  return [...days, day].sort().slice(-ACTIVE_DAYS_KEPT);
}
