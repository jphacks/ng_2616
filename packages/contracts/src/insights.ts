/**
 * Notebook insights: what the home page's progress section draws. Each save records a few counts
 * from the notebook and, now and then, three subject tags the model reads from its content. The
 * tags are never shown on the notebook itself; the home page gathers them into a subject cloud.
 */
import { z } from 'zod';
import { UiLangSchema } from './schemas';

export const TAG_COUNT = 3;
export const TAG_MAX_LENGTH = 40;

/** One spelling per subject: lower case, single spaces, no surrounding punctuation. */
export function normalizeTag(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/^[\s"'`.,;:!?()[\]{}-]+|[\s"'`.,;:!?()[\]{}-]+$/g, '')
    .slice(0, TAG_MAX_LENGTH)
    .trim();
}

/** Normalized, distinct, non-empty, at most three; the model's order (broad first) is kept. */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const tag = normalizeTag(r);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === TAG_COUNT) break;
  }
  return out;
}

export const TagInputSchema = z.object({
  title: z.string().max(200),
  /** the notebook's settled lines as plain text and LaTeX, one per row */
  text: z.string().max(8000),
  /** tags this student already uses, so the model reuses their spelling */
  known_tags: z.array(z.string().max(TAG_MAX_LENGTH)).max(80),
  ui_lang: UiLangSchema,
});

export const TagResultSchema = z.object({ tags: z.array(z.string().max(TAG_MAX_LENGTH)).max(TAG_COUNT), mock: z.boolean() });

export const TagWireSchema = z.object({ tags: z.array(z.string().max(200)).max(6) });

export const TAG_JSON_SCHEMA = {
  type: 'object',
  properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: TAG_COUNT } },
  required: ['tags'],
} as const;

/** Counts recorded from one notebook at each save. */
export const NotebookStatsSchema = z.object({
  /** settled lines with content, not counting the given lines that state the problem */
  lines: z.number().int().nonnegative(),
  /** of those, lines the assistant wrote or completed */
  ai_lines: z.number().int().nonnegative(),
  // GRAPH arrived after stats were first stored: older records read it as 0
  ai_modes: z.object({ COMPLETE_RHS: z.number().int(), NEXT_STEP: z.number().int(), BRIDGE: z.number().int(), GRAPH: z.number().int().default(0) }),
  /** the checker's verdict on each settled line with math */
  checked: z.object({ ok: z.number().int(), wrong: z.number().int(), unknown: z.number().int() }),
  /** wrong lines the checker caught, and how many of them were revised until they held */
  mistakes: z.number().int().nonnegative(),
  fixed: z.number().int().nonnegative(),
  /** hint levels opened while fixing a mistake */
  hints: z.number().int().nonnegative(),
  lean_steps: z.number().int().nonnegative(),
  lean_proofs: z.number().int().nonnegative(),
  graphs: z.number().int().nonnegative(),
});

export type TagInput = z.infer<typeof TagInputSchema>;
export type TagResult = z.infer<typeof TagResultSchema>;
export type TagWire = z.infer<typeof TagWireSchema>;
export type NotebookStats = z.infer<typeof NotebookStatsSchema>;
