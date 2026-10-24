import { z } from 'zod';
import { ImageInputSchema } from './api';
import { WireSegmentSchema } from './llm';
import { FunctionDeclSchema, IdSchema, SegmentSchema, UiLangSchema } from './schemas';
import { wireToSegments, hasUnparsed, hasUnreadable } from './segments';
import { freeSymbols, parseMathLatex, SYMBOL_NAME, validateExpr, type MathJSON } from './ir';
import { canonicalJson } from './hash';

const SymbolSchema = z.string().regex(SYMBOL_NAME);
const LineWireSchema = z.object({ id: IdSchema, segments: z.array(WireSegmentSchema).min(1).max(16), has_unreadable: z.boolean() });
const PremiseWireSchema = z.object({ id: IdSchema, kind: z.enum(['condition', 'definition', 'assumption']), latex: z.string().max(2000), source_line_ids: z.array(IdSchema).min(1).max(16) });
const QuestionWireSchema = z.object({
  id: IdSchema, label: z.string().max(80), title: z.string().min(1).max(200), line_ids: z.array(IdSchema).min(1).max(32),
  unknowns: z.array(SymbolSchema).max(3), independent_var: z.string().max(32), functions: z.array(FunctionDeclSchema).max(16),
  premises: z.array(PremiseWireSchema).max(32),
});

/** Provider transport stays flat; the model neither constructs IR nor decides correctness. */
export const QuestionPageWireSchema = z.object({ complete: z.boolean(), lines: z.array(LineWireSchema).min(1).max(100), questions: z.array(QuestionWireSchema).max(20) });
export const QuestionPageInputSchema = z.object({ page: z.number().int().min(1).max(5), image: ImageInputSchema, text: z.string().max(30000), ui_lang: UiLangSchema });
export const QuestionLineSchema = z.object({ id: IdSchema, segments: z.array(SegmentSchema).min(1).max(16), has_unreadable: z.boolean() });
export const PremiseCandidateSchema = z.object({
  id: IdSchema, kind: z.enum(['condition', 'definition', 'assumption']), latex: z.string(), source_line_ids: z.array(IdSchema),
  selectable: z.boolean(),
});
export const QuestionDraftSchema = z.object({
  id: IdSchema, label: z.string(), title: z.string(), line_ids: z.array(IdSchema), unknowns: z.array(SymbolSchema).max(3),
  independent_var: z.string(), functions: z.array(FunctionDeclSchema).max(16), premises: z.array(PremiseCandidateSchema),
});
export const QuestionPageSchema = z.object({
  page: z.number().int().min(1).max(5), method: z.enum(['text', 'ai', 'fixture']), mock: z.boolean(),
  lines: z.array(QuestionLineSchema).min(1).max(100), questions: z.array(QuestionDraftSchema).max(20),
});
export type QuestionPage = z.infer<typeof QuestionPageSchema>;
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;
export type QuestionLine = z.infer<typeof QuestionLineSchema>;
export type QuestionPageWire = z.infer<typeof QuestionPageWireSchema>;
export type QuestionPageInput = z.infer<typeof QuestionPageInputSchema>;

export function unsafeMath(expr: MathJSON): boolean {
  return !!validateExpr(expr) || (Array.isArray(expr) && (['Unparsed', 'Unreadable'].includes(expr[0]) || expr.slice(1).some(unsafeMathNode)));
}
// Positional nodes/null are valid inside a validated tree, so do not revalidate every child.
function unsafeMathNode(expr: MathJSON): boolean {
  return Array.isArray(expr) && (['Unparsed', 'Unreadable'].includes(expr[0]) || expr.slice(1).some(unsafeMathNode));
}

/** Check references and ground every premise in an actually transcribed math segment. */
export function normalizeQuestionPage(raw: unknown, page: number, method: QuestionPage['method'], mock = false): QuestionPage {
  const wire = QuestionPageWireSchema.parse(raw);
  if (!wire.complete) throw new Error('PDF_TRANSCRIPTION_INCOMPLETE');
  if (new Set(wire.lines.map((l) => l.id)).size !== wire.lines.length || new Set(wire.questions.map((q) => q.id)).size !== wire.questions.length) throw new Error('SCHEMA_INVALID');
  const functions = wire.questions.flatMap((q) => q.functions);
  const lines = wire.lines.map((line) => {
    const parsed = wireToSegments(line.segments, { functions, allowUnparsed: true });
    if (!parsed.ok || !parsed.segments.length) throw new Error('IR_INVALID');
    return { id: line.id, segments: parsed.segments, has_unreadable: line.has_unreadable || hasUnreadable(parsed.segments) };
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  const questions = wire.questions.map((question) => {
    if (new Set(question.line_ids).size !== question.line_ids.length || question.line_ids.some((id) => !byId.has(id))) throw new Error('SCHEMA_INVALID');
    if (question.independent_var && !SYMBOL_NAME.test(question.independent_var)) throw new Error('IR_INVALID');
    if (question.functions.some((f) => !SYMBOL_NAME.test(f.name) || f.args.some((a) => !SYMBOL_NAME.test(a)))) throw new Error('IR_INVALID');
    if (new Set(question.premises.map((p) => p.id)).size !== question.premises.length) throw new Error('SCHEMA_INVALID');
    const premises = question.premises.map((candidate) => {
      const r = parseMathLatex(candidate.latex, { functions: question.functions });
      const refs = candidate.source_line_ids.map((id) => byId.get(id));
      const sourceMath = refs.flatMap((l) => l?.segments.filter((s) => s.type === 'math') ?? []);
      const grounded = r.ok && refs.every((l) => !!l && !l.has_unreadable && !hasUnparsed(l.segments)) && candidate.source_line_ids.every((id) => question.line_ids.includes(id)) && sourceMath.some((s) => canonicalJson(s.expr) === canonicalJson(r.expr));
      return { ...candidate, selectable: !!grounded && r.ok && !unsafeMath(r.expr) };
    });
    return { ...question, premises };
  });
  return QuestionPageSchema.parse({ page, method, mock, lines, questions });
}

export function questionSegments(page: QuestionPage, question: QuestionDraft) {
  return question.line_ids.flatMap((id) => page.lines.find((l) => l.id === id)?.segments ?? []);
}

export function inferredUnknowns(segments: QuestionLine['segments']): string[] {
  const symbols = new Set<string>();
  for (const s of segments) if (s.type === 'math' && !unsafeMath(s.expr)) for (const name of freeSymbols(s.expr)) symbols.add(name);
  return symbols.size <= 3 ? [...symbols] : [];
}

// Zod emits ordinary JSON Schema because all provider-facing fields are flat objects/arrays.
export const QUESTION_PAGE_JSON_SCHEMA = z.toJSONSchema(QuestionPageWireSchema);
