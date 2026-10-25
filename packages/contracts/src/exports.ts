import { z } from 'zod';
import { NotebookSchema, UiLangSchema } from './schemas';

// A document description shared by the notebook, browser PDF and TeX renderers. No ink or hints.
/** A drawn graph line: a PNG from the browser's graph worker (a graph line itself stores only its spec). */
export const GraphPngSchema = z.object({
  png: z.string().max(1_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine((s) => s.startsWith('iVBORw0KGgo'), 'not a PNG'),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
}).strict();
export const PdfFragmentSchema = z.object({ kind: z.enum(['text', 'math']), value: z.string().max(16000) }).strict();
export const PdfBlockSchema = z.object({
  label: z.string().max(200),
  fragments: z.array(PdfFragmentSchema).max(32),
  notes: z.array(z.string().max(2000)).max(12),
  image: GraphPngSchema.optional(),
}).strict();
export const HomeworkLayoutSchema = z.object({
  course: z.string().max(120),
  institution: z.string().max(200),
  date: z.string().max(60),
  exercise: z.string().max(40),
  paper: z.enum(['letter', 'a4']),
  include_records: z.boolean(),
}).strict();
export const ReportDetailsSchema = z.object({
  title: z.string().max(200), author: z.string().max(100), studentId: z.string().max(100),
  homework: HomeworkLayoutSchema.optional(),
}).strict();
export const TexReportRequestSchema = z.object({
  notebook: NotebookSchema,
  language: UiLangSchema,
  report: ReportDetailsSchema,
  /** the browser's drawings of the notebook's graph lines, by line id */
  graphs: z.record(z.string().max(64), GraphPngSchema).refine((g) => Object.keys(g).length <= 24, 'too many graphs').optional(),
}).strict();
export type ReportDetails = z.infer<typeof ReportDetailsSchema>;
export const PdfDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  author: z.string().max(100).optional(),
  student_id: z.string().max(100).optional(),
  language: UiLangSchema,
  homework: HomeworkLayoutSchema.optional(),
  sections: z.array(z.object({ title: z.string().max(200), blocks: z.array(PdfBlockSchema).max(600) }).strict()).max(8),
}).strict();
export type PdfDocument = z.infer<typeof PdfDocumentSchema>;
export type PdfBlock = z.infer<typeof PdfBlockSchema>;
export type PdfFragment = z.infer<typeof PdfFragmentSchema>;
export type GraphPng = z.infer<typeof GraphPngSchema>;
