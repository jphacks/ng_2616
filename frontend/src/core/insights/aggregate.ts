import type { NotebookStats } from '@mn/contracts';
import type { NotebookInsight } from './store';

/** Where a tag sits in a notebook's three: the broad field, the subfield or the topic. */
export type SubjectLevel = 0 | 1 | 2;

export interface Subject {
  tag: string;
  /** notebooks filed under it */
  notebooks: number;
  level: SubjectLevel;
}

/** Every tag the student uses, most notebooks first; a tag's level is where it appears most often. */
export function subjects(rows: readonly NotebookInsight[]): Subject[] {
  const seen = new Map<string, { notebooks: number; at: [number, number, number] }>();
  for (const r of rows) {
    r.tags.forEach((tag, i) => {
      const s = seen.get(tag) ?? { notebooks: 0, at: [0, 0, 0] };
      s.notebooks += 1;
      s.at[Math.min(i, 2)]! += 1;
      seen.set(tag, s);
    });
  }
  return [...seen]
    .map(([tag, s]) => ({ tag, notebooks: s.notebooks, level: s.at.indexOf(Math.max(...s.at)) as SubjectLevel }))
    .sort((a, b) => b.notebooks - a.notebooks || a.level - b.level || a.tag.localeCompare(b.tag));
}

export interface Totals extends NotebookStats {
  notebooks: number;
}

export function totals(rows: readonly NotebookInsight[]): Totals {
  const t: Totals = {
    notebooks: 0,
    lines: 0,
    ai_lines: 0,
    ai_modes: { COMPLETE_RHS: 0, NEXT_STEP: 0, BRIDGE: 0 },
    checked: { ok: 0, wrong: 0, unknown: 0 },
    mistakes: 0,
    fixed: 0,
    hints: 0,
    lean_steps: 0,
    lean_proofs: 0,
    graphs: 0,
  };
  for (const { stats: s } of rows) {
    if (!s) continue;
    t.notebooks += 1;
    t.lines += s.lines;
    t.ai_lines += s.ai_lines;
    for (const m of ['COMPLETE_RHS', 'NEXT_STEP', 'BRIDGE'] as const) t.ai_modes[m] += s.ai_modes[m];
    for (const k of ['ok', 'wrong', 'unknown'] as const) t.checked[k] += s.checked[k];
    t.mistakes += s.mistakes;
    t.fixed += s.fixed;
    t.hints += s.hints;
    t.lean_steps += s.lean_steps;
    t.lean_proofs += s.lean_proofs;
    t.graphs += s.graphs;
  }
  return t;
}

/** Notebooks saved on each day (YYYY-MM-DD). */
export function activity(rows: readonly NotebookInsight[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const r of rows) for (const d of r.active_days) days.set(d, (days.get(d) ?? 0) + 1);
  return days;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar arithmetic on YYYY-MM-DD days, at noon UTC so no time zone shifts the date. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Days in a row with work, ending today, or yesterday when today has none yet. */
export function streak(days: ReadonlyMap<string, number>, today: string): number {
  let day = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}
