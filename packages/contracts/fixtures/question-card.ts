import { normalizeQuestionPage, type QuestionPageWire } from '../src/question-card';

/** A fixed transcription for UI/contract tests. Never returned by the live OCR adapter. */
export function quadraticQuestionFixture() {
  const equations = ['3\\chi^2-15=0', '(\\chi+7)^2-18=0', '\\chi^2+10\\chi+24=0', '\\chi^2-12\\chi+35=0', '\\chi^2-\\chi-72=0', '\\chi^2+19\\chi=0', '\\chi^2-18\\chi+81=0', '3\\chi^2+9\\chi+2=0', '\\chi^2-3\\chi+1=0', '\\chi^2-6\\chi+2=0'];
  const wire: QuestionPageWire = {
    complete: true,
    lines: [{ id: 'instruction', has_unreadable: false, segments: [{ type: 'text', content: '次の方程式を解きなさい。' }] }, ...equations.map((content, i) => ({ id: `L${i + 1}`, has_unreadable: false, segments: [{ type: 'math' as const, content }] }))],
    questions: equations.map((_, i) => ({ id: `Q${i + 1}`, label: String(i + 1), title: `問 ${i + 1}`, line_ids: ['instruction', `L${i + 1}`], unknowns: ['chi'], independent_var: '', functions: [], premises: [] })),
  };
  return normalizeQuestionPage(wire, 1, 'fixture', true);
}
