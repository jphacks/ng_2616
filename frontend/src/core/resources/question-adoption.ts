import { ProblemSchema, canonicalJson, hashOf, questionSegments, unsafeMath, wireToSegments, type Notebook, type Problem, type QuestionPage } from '@mn/contracts';
import { parseMathLatex, SYMBOL_NAME, validateExpr } from '@mn/contracts/ir';
import type { Snapshot } from '@/core/history/history';

export interface QuestionSelection {
  questionId: string; title: string; statement: string; unknowns: string; independentVar: string; premiseIds: string[];
}
export interface QuestionSource { fileName: string; notebookId: string; problemHash: string }
export const problemHash = (problem: Problem) => hashOf(problem);

export function statementSource(page: QuestionPage, questionId: string): string {
  const q = page.questions.find((question) => question.id === questionId);
  if (!q) throw new Error('QUESTION_NOT_FOUND');
  return questionSegments(page, q).map((s) => s.type === 'text' ? s.text : `$${s.latex}$`).join('\n');
}

function symbolFromInput(value: string): string {
  if (SYMBOL_NAME.test(value.trim()) && !validateExpr(value.trim())) return value.trim();
  const parsed = parseMathLatex(value.trim());
  if (!parsed.ok || typeof parsed.expr !== 'string' || !SYMBOL_NAME.test(parsed.expr)) throw new Error('QUESTION_SYMBOL_INVALID');
  return parsed.expr;
}

/** Edits use explicit $...$ math delimiters; unsupported math remains visible and unverified. */
export function parseStatement(source: string, functions: Problem['functions']) {
  if (!source.trim() || source.length > 12000) throw new Error('QUESTION_STATEMENT_INVALID');
  const wire: { type: 'text' | 'math'; content: string }[] = [];
  const parts = source.split('$');
  if (parts.length % 2 === 0) throw new Error('QUESTION_STATEMENT_INVALID');
  parts.forEach((content, i) => { if (content.trim()) wire.push({ type: i % 2 ? 'math' : 'text', content }); });
  const parsed = wireToSegments(wire, { functions, allowUnparsed: true });
  if (!parsed.ok || !parsed.segments.length) throw new Error('QUESTION_STATEMENT_INVALID');
  return parsed.segments;
}

/** Prepare a new card; candidates do not enter the CAS context until explicitly selected. */
export function prepareQuestionProblem(page: QuestionPage, source: QuestionSource, selection: QuestionSelection): Problem {
  const question = page.questions.find((q) => q.id === selection.questionId);
  if (!question) throw new Error('QUESTION_NOT_FOUND');
  const chosen = new Set(selection.premiseIds);
  if (chosen.size !== selection.premiseIds.length || [...chosen].some((id) => !question.premises.some((p) => p.id === id && p.selectable))) throw new Error('QUESTION_PREMISE_INVALID');
  const statement = parseStatement(selection.statement, question.functions);
  const problem: Problem = {
    id: `pdf_${hashOf({ file: source.fileName, page: page.page, question: question.id }).slice(7, 31)}`, title: selection.title.trim() || question.title, statement,
    definitions: [], conditions: [], assumptions: [],
    unknowns: selection.unknowns.split(/[,、\s]+/).filter(Boolean).map(symbolFromInput),
    ...(selection.independentVar.trim() ? { independent_var: symbolFromInput(selection.independentVar) } : {}), functions: question.functions,
    origin: { kind: 'pdf', name: source.fileName, page: page.page, question_label: question.label, transcription: page.method, corrected: selection.statement !== statementSource(page, question.id), mock: page.mock },
  };
  if (new Set(problem.unknowns).size !== problem.unknowns.length || problem.title.length > 200) throw new Error('QUESTION_SYMBOL_INVALID');
  for (const candidate of question.premises.filter((p) => chosen.has(p.id))) {
    const math = parseMathLatex(candidate.latex, { functions: question.functions });
    if (!math.ok || unsafeMath(math.expr)) throw new Error('QUESTION_PREMISE_INVALID');
    const refs = candidate.source_line_ids.map((id) => page.lines.find((l) => l.id === id));
    if (refs.some((l) => !l || l.has_unreadable) || !refs.some((l) => l?.segments.some((s) => s.type === 'math' && !unsafeMath(s.expr) && canonicalJson(s.expr) === canonicalJson(math.expr)))) throw new Error('QUESTION_PREMISE_INVALID');
    if (candidate.kind === 'assumption') {
      if (!candidate.assumption) throw new Error('QUESTION_PREMISE_INVALID');
      problem.assumptions.push({ ...candidate.assumption, source: 'adopted' });
    } else problem[candidate.kind === 'definition' ? 'definitions' : 'conditions'].push(math.expr);
  }
  return ProblemSchema.parse(problem);
}

/** A single existing IMPORT_PDF command changes only the card; all ink/line order is retained. */
export function questionImportSnapshot(snapshot: Snapshot, problem: Problem): Snapshot {
  return { ...snapshot, problem, lines: snapshot.lines.map((line) => line.state === 'SETTLED' && line.segments.some((s) => s.type === 'math') ? { ...line, version: line.version + 1, verified: undefined } : line) };
}

export function canAdoptQuestion(notebook: Notebook, source: QuestionSource): boolean {
  return notebook.id === source.notebookId && problemHash(notebook.problem) === source.problemHash;
}
