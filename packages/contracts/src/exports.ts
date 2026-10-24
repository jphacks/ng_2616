import { z } from 'zod';
import { UiLangSchema } from './schemas';

// A document description shared by the notebook and the browser PDF renderer. No ink or hints.
export const PdfFragmentSchema = z.object({ kind: z.enum(['text', 'math']), value: z.string().max(16000) }).strict();
export const PdfBlockSchema = z.object({
  label: z.string().max(200),
  fragments: z.array(PdfFragmentSchema).max(32),
  notes: z.array(z.string().max(2000)).max(12),
}).strict();
export const PdfDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  author: z.string().max(100).optional(),
  student_id: z.string().max(100).optional(),
  language: UiLangSchema,
  sections: z.array(z.object({ title: z.string().max(200), blocks: z.array(PdfBlockSchema).max(600) }).strict()).max(8),
}).strict();
export type PdfDocument = z.infer<typeof PdfDocumentSchema>;
export type PdfBlock = z.infer<typeof PdfBlockSchema>;
export type PdfFragment = z.infer<typeof PdfFragmentSchema>;
