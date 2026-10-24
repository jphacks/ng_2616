/** Request/response bodies for /api/v1/* (spec §7.1, adapted for Stage 1). */
import { z } from 'zod';
import {
  FeatureSchema,
  FunctionDeclSchema,
  MathJSONSchema,
  MetaSchema,
  RoleSchema,
  SegmentSchema,
  StatusSchema,
  SuggestModeSchema,
  TargetSchema,
  UiLangSchema,
} from './schemas';
import { CheckerRouteSchema, LeanStepStateSchema } from './lean';

/** Scripted demo binding (the Schrödinger notebook). */
export const DemoBindingSchema = z.object({ script: z.string().max(64) });

export const ImageInputSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg']),
  /** base64 without a data: prefix; ≤ 1 MiB decoded, longest side ≤ 1000 px */
  data: z.string().max(1_400_000),
});

export const RecognizeInputSchema = z.object({
  image: ImageInputSchema,
  previous_math_latex: z.string().max(4000).optional(),
  functions: z.array(FunctionDeclSchema).max(16).optional(),
  symbols: z.array(z.string()).max(32).optional(),
  ui_lang: UiLangSchema,
  prefetch: z.boolean().optional(),
  demo: DemoBindingSchema.optional(),
  /** how many user-written math lines precede this one (lets the mock pick its scripted line) */
  user_line_index: z.number().int().min(0).optional(),
});

export const RecognizeResultSchema = z.object({
  segments: z.array(SegmentSchema),
  unreadable: z.boolean(),
  mock: z.boolean(),
  /** the raw transcription, kept for debugging and for the "we read…" hint on failure */
  transcription: z.string().optional(),
  /** v2.3: the checker the model chose for this line (ADR 0008) */
  route: CheckerRouteSchema.optional(),
});

export const SuggestContextLineSchema = z.object({
  id: z.string(),
  role: RoleSchema,
  source: z.enum(['user', 'ai', 'pdf', 'resource']),
  status: StatusSchema.optional(),
  segments: z.array(SegmentSchema),
  /** v2.3: the checker this line went to, and what Lean said about it (ADR 0008) */
  route: CheckerRouteSchema.optional(),
  lean: LeanStepStateSchema.optional(),
});

export const ReferenceExcerptSchema = z.object({
  name: z.string().max(200),
  page: z.number().int().min(1),
  text: z.string().max(9000),
});

/** v2.2: why the browser CAS judged an earlier attempt of the same request wrong. */
export const CheckerFeedbackSchema = z.object({
  latex: z.string().max(4000),
  reason: z.string().max(64).optional(),
  /** CAS evidence summaries, e.g. "At x = 1, the expected value is 2 but this line gives 3." */
  evidence: z.array(z.string().max(500)).max(3),
});

export const SuggestInputSchema = z.object({
  context: z.object({
    /** v2.2: functions the notebook's lines declare (the problem card is gone) */
    functions: z.array(FunctionDeclSchema).max(16).optional(),
    lines: z.array(SuggestContextLineSchema).max(64),
  }),
  mode: SuggestModeSchema,
  based_on_line_id: z.string(),
  target_line_id: z.string(),
  lhs_expr: MathJSONSchema.optional(),
  rejected_hashes: z.array(z.string()).max(64),
  /** v2.1: LaTeX of rejected candidates so the model can avoid repeating them */
  rejected_latex: z.array(z.string().max(4000)).max(16).optional(),
  /** v2.2: CAS rejections of this request's earlier attempts, so the model can correct itself */
  checker_feedback: z.array(CheckerFeedbackSchema).max(3).optional(),
  reference: z.array(ReferenceExcerptSchema).max(16).optional(),
  ui_lang: UiLangSchema,
  demo: DemoBindingSchema.optional(),
});

export const CandidateDraftLineSchema = z.object({
  target: TargetSchema,
  segments: z.array(SegmentSchema),
  /** v2.3: a proof step goes to Lean, not the CAS (ADR 0008) */
  route: CheckerRouteSchema.optional(),
});

export const CandidateDraftResultSchema = z.object({
  state: z.enum(['GENERATED', 'NONE']),
  reason: z.string().optional(),
  mock: z.boolean(),
  candidate: z
    .object({
      id: z.string(),
      mode: SuggestModeSchema,
      content_hash: z.string(),
      lines: z.array(CandidateDraftLineSchema).min(1).max(3),
    })
    .optional(),
});

export const OcrPageInputSchema = z.object({ image: ImageInputSchema, ui_lang: UiLangSchema });
export const OcrPageResultSchema = z.object({ text: z.string(), mock: z.boolean() });

export const CapabilitiesSchema = z.object({
  schema_version: z.string(),
  build_id: z.string(),
  features: z.record(FeatureSchema, z.boolean()),
  cas_runtime: z.literal('pyodide'),
  ai_execution: z.enum(['direct', 'relay']),
  llm: z.object({ provider: z.string(), configured: z.boolean(), mock: z.boolean() }),
  lean: z.object({ available: z.boolean(), toolchain: z.string().optional(), mathlib: z.string().optional() }),
});

export const HealthSchema = z.object({
  status: z.literal('ok'),
  build_id: z.string(),
  llm_configured: z.boolean(),
  lean_ready: z.boolean(),
});

export const RequestEnvelopeSchema = <T extends z.ZodType>(input: T) => z.object({ meta: MetaSchema, input });

export type DemoBinding = z.infer<typeof DemoBindingSchema>;
export type ImageInput = z.infer<typeof ImageInputSchema>;
export type RecognizeInput = z.infer<typeof RecognizeInputSchema>;
export type RecognizeResult = z.infer<typeof RecognizeResultSchema>;
export type SuggestContextLine = z.infer<typeof SuggestContextLineSchema>;
export type ReferenceExcerpt = z.infer<typeof ReferenceExcerptSchema>;
export type CheckerFeedback = z.infer<typeof CheckerFeedbackSchema>;
export type SuggestInput = z.infer<typeof SuggestInputSchema>;
export type CandidateDraftLine = z.infer<typeof CandidateDraftLineSchema>;
export type CandidateDraftResult = z.infer<typeof CandidateDraftResultSchema>;
export type OcrPageInput = z.infer<typeof OcrPageInputSchema>;
export type OcrPageResult = z.infer<typeof OcrPageResultSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type Health = z.infer<typeof HealthSchema>;
