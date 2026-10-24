'use client';

import type { QuestionPage, UiLang } from '@mn/contracts';
import { closePdf, openPdf, type PdfDoc } from './pdf';
import { positionedPdfLines, questionPageFromText } from './question-text';

export const MAX_QUESTION_BYTES = 10 * 1024 * 1024;
export const MAX_QUESTION_PAGES = 5;
export interface QuestionPdf { doc: PdfDoc; pages: QuestionPage[]; text: string[]; fileName: string }

export async function readQuestionPdf(file: File, lang: UiLang, signal: AbortSignal): Promise<QuestionPdf> {
  if (file.size > MAX_QUESTION_BYTES) throw new Error('QUESTION_FILE_TOO_LARGE');
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('QUESTION_FILE_INVALID');
  signal.throwIfAborted();
  const bytes = await file.arrayBuffer();
  let doc: PdfDoc;
  try { doc = await openPdf(bytes); } catch { throw new Error('QUESTION_PDF_UNREADABLE'); }
  try {
    signal.throwIfAborted();
    if (doc.numPages > MAX_QUESTION_PAGES) throw new Error('QUESTION_PAGE_LIMIT');
    const pages: QuestionPage[] = [];
    const text: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      signal.throwIfAborted();
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines = positionedPdfLines(content.items.filter((item) => 'str' in item));
      text.push(lines.join('\n'));
      pages.push(questionPageFromText(lines, p, lang));
    }
    signal.throwIfAborted();
    return { doc, pages, text, fileName: file.name };
  } catch (e) { await closePdf(doc); throw e; }
}
