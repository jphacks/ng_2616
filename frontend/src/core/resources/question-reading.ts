import { canonicalJson, unsafeMath, type QuestionPage } from '@mn/contracts';

export const questionLabel = (label: string) => label.normalize('NFKC').replace(/[()\s]/g, '');

/** Compare like-numbered questions, without correcting either reading or claiming OCR is true. */
export function changedQuestionMath(original: QuestionPage, reread: QuestionPage): string[] {
  const formulas = (page: QuestionPage, ids: string[]) => page.lines
    .filter((line) => ids.includes(line.id))
    .flatMap((line) => line.segments.flatMap((segment) => segment.type === 'math' && !unsafeMath(segment.expr) ? [canonicalJson(segment.expr)] : [])).sort();
  return original.questions.flatMap((question) => {
    const match = reread.questions.find((q) => questionLabel(q.label) === questionLabel(question.label));
    if (!match) return [];
    const before = formulas(original, question.line_ids);
    return before.length && JSON.stringify(before) !== JSON.stringify(formulas(reread, match.line_ids)) ? [question.label || question.title] : [];
  });
}
