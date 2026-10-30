/**
 * Shared data model (spec §5) as Zod schemas. snake_case on the wire and in snapshots.
 * v2.1 additions are marked; see docs/design/v2.1-deltas.md.
 */
import { z } from 'zod';
import type { MathJSON } from './ir/ops';
import { migrateNotebook } from './legacy';

// v2.2: the problem card is gone; a notebook is its lines (see legacy.ts for older snapshots)
export const SCHEMA_VERSION = '2.2.0' as const;
export const RULES_VERSION = '2.0.0' as const;

export const MathJSONSchema: z.ZodType<MathJSON> = z.lazy(() =>
  z.union([z.string(), z.number(), z.null(), z.tuple([z.string()], MathJSONSchema)]),
);

export const IdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const UuidSchema = z.uuid();
export const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const StatusSchema = z.enum(['ok', 'wrong', 'unknown', 'none']);
// v2.1: 'sep' (separation constant), 'sub' (substitution check), 'scale' (nonzero scaling)
export const MethodSchema = z.enum(['sym', 'sets', 'solve', 'eval', 'cx', 'num', 'def', 'sep', 'sub', 'scale']);
export const RoleSchema = z.enum(['premise', 'definition', 'step', 'text']);
export const SourceSchema = z.enum(['user', 'ai', 'pdf', 'resource']);
/** GRAPH answers a line that asks for a graph with a graph line (rendered by matplotlib, never checked by the CAS). */
export const SuggestModeSchema = z.enum(['COMPLETE_RHS', 'NEXT_STEP', 'BRIDGE', 'GRAPH']);
export const FeatureSchema = z.enum(['hints', 'assist_modes', 'bridge', 'plot', 'lean', 'autosave', 'auto_submit', 'resources']);
export const NotationSchema = z.enum(['plain', 'continuation']);
export const UiLangSchema = z.enum(['en', 'ja']);

export const InputSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(4000) }),
  z.object({ type: z.literal('math'), expr: MathJSONSchema, notation: NotationSchema }),
]);

export const SegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(4000) }),
  z.object({
    type: z.literal('math'),
    expr: MathJSONSchema,
    notation: NotationSchema,
    latex: z.string(),
    /** v2.2: the LaTeX as read, parsed again when a later line declares one of its functions */
    source_latex: z.string().max(4000).optional(),
  }),
]);

export const StrokePointSchema = z.object({ x: z.number(), y: z.number(), t: z.number(), p: z.number() });
export const StrokeSchema = z.object({ id: IdSchema, points: z.array(StrokePointSchema).max(20000) });

/** v2.1: declared functions disambiguate ψ(x) (application) from a·(x) (product). */
export const FunctionDeclSchema = z.object({ name: z.string(), args: z.array(z.string()).max(4) });

export const EvidenceSchema = z.object({
  kind: z.enum(['COUNTEREXAMPLE', 'SOLUTION_DIFF', 'DOMAIN_CONDITION', 'EXACT_MISMATCH']),
  assignment: z.record(z.string(), z.string()).optional(),
  context_value: z.string().optional(),
  written_value: z.string().optional(),
  missing: z.array(z.string()).optional(),
  extra: z.array(z.string()).optional(),
  condition_latex: z.string().optional(),
  approx: z.boolean().optional(),
  summary: z.string(),
});

export const SegmentProofSchema = z.object({
  segment_index: z.number().int(),
  status: StatusSchema,
  goal: z.string().optional(),
  method: MethodSchema.optional(),
  reason: z.string().optional(),
  category: z.string().optional(),
  conditions: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  /** v2.1: id of the earlier line the segment was compared against */
  source_line_id: z.string().optional(),
});

export const HintSchema = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  text: z.string(),
  refs: z.array(z.string()),
  /** v2.1: template id + slots so the UI can re-render the hint in the current language */
  template_id: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional(),
});

export const ProofSchema = z.object({
  status: StatusSchema,
  goal: z.string().optional(),
  method: MethodSchema.optional(),
  reason: z.string().optional(),
  category: z.string().optional(),
  conditions: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  hints: z.array(HintSchema),
  segment_results: z.array(SegmentProofSchema),
  depends_on: z.array(z.string()),
  depends_on_unverified: z.boolean(),
  unverified_ancestors: z.array(z.string()),
  input_hash: HashSchema,
  mock: z.boolean(),
  cas: z.object({
    version: z.string(),
    rules_version: z.literal(RULES_VERSION),
    elapsed_ms: z.number(),
    timed_out: z.boolean(),
  }),
});

export const VerifiedSchema = z.object({ verification_id: z.string(), input_hash: HashSchema, proof: ProofSchema });

export const LineStateSchema = z.enum(['DRAFT', 'RECOGNIZING', 'RECOGNIZE_FAILED', 'VERIFYING', 'SETTLED', 'SUPERSEDED']);

export const LineSchema = z.object({
  id: IdSchema,
  version: z.number().int(),
  source: SourceSchema,
  role: RoleSchema,
  state: LineStateSchema,
  ink: z.array(StrokeSchema),
  segments: z.array(SegmentSchema).max(16),
  parent_id: IdSchema.optional(),
  verified: VerifiedSchema.optional(),
  failure: z.object({ stage: z.enum(['recognize', 'verify']), code: z.string(), message: z.string().optional() }).optional(),
  revision_of: IdSchema.optional(),
  recovery_root_id: IdSchema.optional(),
  superseded_by: IdSchema.optional(),
  is_memo: z.boolean().optional(),
  ai_origin: z.object({ candidate_id: z.string(), mode: SuggestModeSchema, unverified_adoption: z.boolean().optional() }).optional(),
  document_origin: z.object({ name: z.string(), page: z.number().int(), has_unreadable: z.boolean() }).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export const RecoverySchema = z.object({
  root_line_id: IdSchema,
  current_line_id: IdSchema,
  phase: z.enum(['WRONG_SHOWN', 'EVIDENCE_OPEN', 'HINT_FOCUS', 'HINT_LOCATE', 'REVISING', 'REVERIFYING', 'RECOVERED', 'UNRESOLVED']),
  opened_at: z.record(z.string(), z.number()),
});

export const NotebookSchema = z.preprocess(
  (raw) => migrateNotebook(raw, SCHEMA_VERSION),
  z.object({
    schema_version: z.literal(SCHEMA_VERSION),
    id: UuidSchema,
    title: z.string().min(1).max(200),
    mode: z.enum(['live', 'mock']),
    domain: z.literal('Reals'),
    lines: z.array(LineSchema),
    recoveries: z.array(RecoverySchema),
    extensions: z.record(z.string(), z.unknown()).optional(),
  }),
);

export const MetaSchema = z.object({
  request_id: UuidSchema,
  notebook_id: UuidSchema,
  client_session_id: UuidSchema,
  client_epoch: z.number().int(),
  line_id: IdSchema.optional(),
  line_version: z.number().int().optional(),
  context_fingerprint: HashSchema,
});

export const TargetSchema = z.object({
  id: IdSchema,
  role: RoleSchema,
  segments: z.array(InputSegmentSchema),
  revision_of: IdSchema.optional(),
  recovery_root_id: IdSchema.optional(),
});

export const JobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']);

export const JobErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });

export function jobSchema<T extends z.ZodType>(result: T) {
  return z.object({
    id: z.string(),
    kind: z.string(),
    state: JobStateSchema,
    phase: z.string(),
    meta: MetaSchema,
    created_at: z.string(),
    expires_at: z.string(),
    result: result.optional(),
    error: JobErrorSchema.optional(),
  });
}

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  retry_after_ms: z.number().optional(),
});

export function apiResponseSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), request_id: z.string(), data }),
    z.object({ ok: z.literal(false), request_id: z.string(), error: ApiErrorSchema }),
  ]);
}

export type Status = z.infer<typeof StatusSchema>;
export type Method = z.infer<typeof MethodSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type SuggestMode = z.infer<typeof SuggestModeSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Notation = z.infer<typeof NotationSchema>;
export type UiLang = z.infer<typeof UiLangSchema>;
export type InputSegment = z.infer<typeof InputSegmentSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type StrokePoint = z.infer<typeof StrokePointSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;
export type FunctionDecl = z.infer<typeof FunctionDeclSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type SegmentProof = z.infer<typeof SegmentProofSchema>;
export type Hint = z.infer<typeof HintSchema>;
export type Proof = z.infer<typeof ProofSchema>;
export type Verified = z.infer<typeof VerifiedSchema>;
export type LineState = z.infer<typeof LineStateSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Recovery = z.infer<typeof RecoverySchema>;
export type Notebook = z.infer<typeof NotebookSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

export interface Job<T = unknown> {
  id: string;
  kind: string;
  state: JobState;
  phase: string;
  meta: Meta;
  created_at: string;
  expires_at: string;
  result?: T;
  error?: { code: string; message: string; retryable: boolean };
}

export type ApiResponse<T> =
  | { ok: true; request_id: string; data: T }
  | { ok: false; request_id: string; error: ApiError };
