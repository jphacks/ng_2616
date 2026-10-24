/**
 * Lean proof checking (ADR 0007). The model decides which checker a line needs: the CAS for
 * algebra, Lean for proof steps written in words, or neither for filler. Lean's verdicts live
 * beside the CAS report, never inside it: `Line.extensions.lean` and `Notebook.extensions.lean`.
 */
import { z } from 'zod';
import { FunctionDeclSchema, HashSchema, SegmentSchema, UiLangSchema, type Line, type Notebook } from './schemas';

/** Which checker a line goes to; the model picks it when it reads the line. */
export const CheckerRouteSchema = z.enum(['cas', 'lean', 'none']);

/** Overall answer of one Lean check (lean-worker /check, plus states of our own). */
export const LeanStateSchema = z.enum(['proved', 'incomplete', 'failed', 'invalid', 'timeout', 'unavailable']);
/** What happened to one line's step inside that check. */
export const LeanStepStateSchema = z.enum(['ok', 'failed', 'unchecked', 'empty']);

export const LeanVersionsSchema = z.object({ toolchain: z.string().max(64), mathlib: z.string().max(64) });

/** The theorem a proof notebook proves, as a Lean proposition (Notebook.extensions.lean.theorem). */
export const LeanTheoremSchema = z.object({
  statement: z.string().min(1).max(2000),
  /** hash of the given lines it was written from; a changed problem formalizes again */
  given_hash: HashSchema,
  /** a template's reviewed statement, or the model's reading of the given lines */
  source: z.enum(['template', 'ai']),
});

/** Lean's verdict on one line (Line.extensions.lean). */
export const LineLeanSchema = z.object({
  /** the Lean tactic this line became; later checks reuse it so the proof stays the same */
  tactic: z.string().max(2000),
  /** set once this line itself was checked: its step's state in that check */
  step: LeanStepStateSchema.optional(),
  /** the whole proof's state when this line was checked */
  proof: LeanStateSchema.optional(),
  /** "line" when no theorem is stated and Lean proved this line's own claim */
  scope: z.enum(['theorem', 'line']).optional(),
  /** an earlier step failed: this one holds only if that one does */
  after_failure: z.boolean().optional(),
  statement: z.string().max(2000).optional(),
  message: z.string().max(2000).optional(),
  goals: z.string().max(2000).optional(),
  hint: z.string().max(600).optional(),
  /** hash of what the check depended on: the theorem and every proof line up to this one */
  context_hash: HashSchema.optional(),
  versions: LeanVersionsSchema.optional(),
});

export const LeanCheckLineSchema = z.object({
  id: z.string().max(64),
  route: CheckerRouteSchema,
  segments: z.array(SegmentSchema).max(16),
  /** the translation an earlier check made; absent lines are translated now */
  tactic: z.string().max(2000).optional(),
});

export const LeanCheckInputSchema = z.object({
  theorem: LeanTheoremSchema.optional(),
  /** given lines (the problem) as the student sees them */
  given: z.array(z.object({ id: z.string().max(64), segments: z.array(SegmentSchema).max(16) })).max(32),
  given_hash: HashSchema,
  /** proof lines in page order, ending with the target */
  lines: z.array(LeanCheckLineSchema).min(1).max(64),
  target_line_id: z.string().max(64),
  functions: z.array(FunctionDeclSchema).max(16).optional(),
  /** a suggestion being checked before it is shown, not a line the student wrote */
  candidate: z.boolean().optional(),
  ui_lang: UiLangSchema,
});

export const LeanCheckStepSchema = z.object({
  line_id: z.string().max(64),
  tactic: z.string().max(2000),
  state: LeanStepStateSchema,
  message: z.string().max(2000).optional(),
});

export const LeanCheckResultSchema = z.object({
  state: LeanStateSchema,
  scope: z.enum(['theorem', 'line']),
  theorem: LeanTheoremSchema.optional(),
  statement: z.string().max(2000).optional(),
  steps: z.array(LeanCheckStepSchema).max(64),
  goals: z.string().max(2000).optional(),
  message: z.string().max(2000).optional(),
  hint: z.string().max(600).optional(),
  attempts: z.number().int().min(0),
  mock: z.boolean(),
  versions: LeanVersionsSchema.optional(),
});

/** Model output for one Lean check: the theorem when it is not known yet, and the missing tactics. */
export const LeanStepWireSchema = z.object({
  scope: z.enum(['theorem', 'line']),
  statement: z.string().max(2000),
  steps: z.array(z.object({ line_id: z.string().max(64), tactic: z.string().max(2000) })).max(64),
  hint: z.string().max(600),
});

export const LEAN_STEP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['theorem', 'line'] },
    statement: { type: 'string' },
    steps: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        properties: { line_id: { type: 'string' }, tactic: { type: 'string' } },
        required: ['line_id', 'tactic'],
        additionalProperties: false,
      },
    },
    hint: { type: 'string' },
  },
  required: ['scope', 'statement', 'steps', 'hint'],
  additionalProperties: false,
} as const;

export type CheckerRoute = z.infer<typeof CheckerRouteSchema>;
export type LeanState = z.infer<typeof LeanStateSchema>;
export type LeanStepState = z.infer<typeof LeanStepStateSchema>;
export type LeanVersions = z.infer<typeof LeanVersionsSchema>;
export type LeanTheorem = z.infer<typeof LeanTheoremSchema>;
export type LineLean = z.infer<typeof LineLeanSchema>;
export type LeanCheckLine = z.infer<typeof LeanCheckLineSchema>;
export type LeanCheckInput = z.infer<typeof LeanCheckInputSchema>;
export type LeanCheckStep = z.infer<typeof LeanCheckStepSchema>;
export type LeanCheckResult = z.infer<typeof LeanCheckResultSchema>;
export type LeanStepWire = z.infer<typeof LeanStepWireSchema>;

/** The checker the model chose for a line; lines read before routing existed go to the CAS. */
export function routeOf(line: Pick<Line, 'extensions'>): CheckerRoute {
  const r = CheckerRouteSchema.safeParse(line.extensions?.route);
  return r.success ? r.data : 'cas';
}

export function leanOf(line: Pick<Line, 'extensions'>): LineLean | undefined {
  const r = LineLeanSchema.safeParse(line.extensions?.lean);
  return r.success ? r.data : undefined;
}

export function withLineLean<L extends Pick<Line, 'extensions'>>(line: L, lean: LineLean | undefined): L {
  const { lean: _old, ...rest } = line.extensions ?? {};
  return { ...line, extensions: lean ? { ...rest, lean } : rest };
}

export function theoremOf(nb: Pick<Notebook, 'extensions'>): LeanTheorem | undefined {
  const r = LeanTheoremSchema.safeParse((nb.extensions?.lean as { theorem?: unknown } | undefined)?.theorem);
  return r.success ? r.data : undefined;
}

export function withTheorem<N extends Pick<Notebook, 'extensions'>>(nb: N, theorem: LeanTheorem | undefined): N {
  const lean = { ...((nb.extensions?.lean as Record<string, unknown> | undefined) ?? {}) };
  if (theorem) lean.theorem = theorem;
  else delete lean.theorem;
  return { ...nb, extensions: { ...(nb.extensions ?? {}), lean } };
}
