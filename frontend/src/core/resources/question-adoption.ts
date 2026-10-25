import { LineSchema, canonicalJson, hashOf, unsafeMath, wireToSegments, type Line, type Notebook, type QuestionPage } from '@mn/contracts';
import { parseMathLatex } from '@mn/contracts/ir';
import type { Snapshot } from '@/core/history/history';
import { shortId } from '@/core/ids';

export interface QuestionSelection { questionId: string; title: string; statement: string; premiseIds: string[] }
export interface QuestionSource { fileName: string; notebookId: string; contextHash: string }
// New ink is allowed during review, but a change to the mathematical context is not.
export const questionContextHash = (notebook: Notebook) => hashOf(notebook.lines.filter((l) => l.state === 'SETTLED').map((l) => ({ id: l.id, role: l.role, segments: l.segments })));

/** Candidates are reviewed separately, so unchecked assumptions never enter CAS. */
export function statementSource(page: QuestionPage, questionId: string): string {
  const question = page.questions.find((q) => q.id === questionId);
  if (!question) throw new Error('QUESTION_NOT_FOUND');
  return question.line_ids.flatMap((id) => {
    const line = page.lines.find((l) => l.id === id);
    if (!line) return [];
    return line.segments.filter((segment) => {
      if (segment.type !== 'math') return true;
      return !question.premises.some((candidate) => {
        if (!candidate.source_line_ids.includes(id)) return false;
        const parsed = parseMathLatex(candidate.latex, { functions: question.functions });
        return parsed.ok && canonicalJson(parsed.expr) === canonicalJson(segment.expr);
      });
    });
  }).map((s) => s.type === 'text' ? s.text : '$' + s.latex + '$').join('\n');
}

export function parseStatement(source: string, functions: QuestionPage['questions'][number]['functions']) {
  if (!source.trim() || source.length > 12000) throw new Error('QUESTION_STATEMENT_INVALID');
  const wire: { type: 'text' | 'math'; content: string }[] = [];
  const parts = source.split('$');
  if (parts.length % 2 === 0) throw new Error('QUESTION_STATEMENT_INVALID');
  parts.forEach((content, i) => { if (content.trim()) wire.push({ type: i % 2 ? 'math' : 'text', content }); });
  const parsed = wireToSegments(wire, { functions, allowUnparsed: true });
  if (!parsed.ok || !parsed.segments.length) throw new Error('QUESTION_STATEMENT_INVALID');
  return parsed.segments;
}

/** v2.2: ordinary lines, one formula per given line. No problem card is stored. */
export function prepareQuestionLines(page: QuestionPage, source: QuestionSource, selection: QuestionSelection): Line[] {
  const question = page.questions.find((q) => q.id === selection.questionId);
  if (!question) throw new Error('QUESTION_NOT_FOUND');
  if (selection.title.length > 200) throw new Error('QUESTION_STATEMENT_INVALID');
  const chosen = new Set(selection.premiseIds);
  if (chosen.size !== selection.premiseIds.length || [...chosen].some((id) => !question.premises.some((p) => p.id === id && p.selectable))) throw new Error('QUESTION_PREMISE_INVALID');
  const metadata = { question_id: question.id, label: question.label, title: selection.title.trim() || question.title, transcription: page.method, corrected: selection.statement !== statementSource(page, question.id), mock: page.mock };
  const lines: Line[] = [];
  const append = (segment: Line['segments'][number], role: Line['role'] = 'premise') => {
    const unreadable = segment.type === 'math' && unsafeMath(segment.expr);
    const segments: Line['segments'] = unreadable && segment.type === 'math' ? [{ type: 'text', text: segment.latex }] : [segment];
    lines.push(LineSchema.parse({ id: shortId('pdf'), version: 1, state: 'SETTLED', source: 'pdf', role: unreadable ? 'text' : role, ink: [], segments,
      document_origin: { name: source.fileName, page: page.page, has_unreadable: unreadable }, extensions: { pdf_question: metadata } }));
  };
  for (const segment of parseStatement(selection.statement, question.functions)) append(segment, segment.type === 'text' ? 'text' : 'premise');
  for (const candidate of question.premises.filter((p) => chosen.has(p.id))) {
    const parsed = parseMathLatex(candidate.latex, { functions: question.functions });
    const refs = candidate.source_line_ids.map((id) => page.lines.find((l) => l.id === id));
    if (!parsed.ok || unsafeMath(parsed.expr) || !refs.length || candidate.source_line_ids.some((id) => !question.line_ids.includes(id)) || refs.some((l) => !l || l.has_unreadable) || !refs.some((l) => l?.segments.some((s) => s.type === 'math' && !unsafeMath(s.expr) && canonicalJson(s.expr) === canonicalJson(parsed.expr)))) throw new Error('QUESTION_PREMISE_INVALID');
    const wire = wireToSegments([{ type: 'math', content: candidate.latex }], { functions: question.functions });
    if (!wire.ok) throw new Error('QUESTION_PREMISE_INVALID');
    wire.segments.forEach((s) => append(s, candidate.kind === 'definition' ? 'definition' : 'premise'));
  }
  return lines;
}

/** Insert before the active draft; prior derivations and all ink keep their order. */
export function questionImportSnapshot(snapshot: Snapshot, imported: Line[]): Snapshot {
  const ids = new Set(snapshot.lines.map((l) => l.id));
  for (const line of imported) { if (ids.has(line.id)) throw new Error('QUESTION_CONTEXT_CHANGED'); ids.add(line.id); }
  const active = snapshot.lines.findIndex((l) => l.id === snapshot.activeLineId && l.state === 'DRAFT');
  const firstDraft = snapshot.lines.findIndex((l) => l.state === 'DRAFT');
  const at = active >= 0 ? active : firstDraft >= 0 ? firstDraft : snapshot.lines.length;
  const lines = [...snapshot.lines.slice(0, at), ...imported, ...snapshot.lines.slice(at).map((l) => l.state === 'SETTLED' && l.segments.some((s) => s.type === 'math') ? { ...l, version: l.version + 1, verified: undefined } : l)];
  return { ...snapshot, lines };
}

export const canAdoptQuestion = (notebook: Notebook, source: QuestionSource) => notebook.id === source.notebookId && questionContextHash(notebook) === source.contextHash;
