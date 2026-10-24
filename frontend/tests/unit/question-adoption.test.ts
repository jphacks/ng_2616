import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quadraticQuestionFixture } from '@mn/contracts/fixtures';
import { normalizeQuestionPage } from '@mn/contracts';
import { buildNotebook } from '../../src/core/presets';
import { notebookStore } from '../../src/core/store/notebook-store';
import { canAdoptQuestion, parseStatement, prepareQuestionProblem, problemHash, questionImportSnapshot, statementSource, type QuestionSelection } from '../../src/core/resources/question-adoption';

const page = quadraticQuestionFixture();
const notebook = () => buildNotebook('blank', 'ja');
const selection = (id = 'Q1'): QuestionSelection => ({ questionId: id, title: '問1', statement: statementSource(page, id), unknowns: 'chi', independentVar: '', premiseIds: [] });
const source = (n = notebook()) => ({ fileName: 'test_questioncard.pdf', notebookId: n.id, problemHash: problemHash(n.problem) });

test('question adoption keeps assumptions empty, keeps source symbols and records page/question', () => {
  const p = prepareQuestionProblem(page, source(), selection('Q10'));
  assert.deepEqual(p.conditions, []); assert.deepEqual(p.assumptions, []); assert.deepEqual(p.unknowns, ['chi']);
  assert.equal(p.origin?.question_label, '10'); assert.equal(p.origin?.page, 1);
});
test('reuses existing IMPORT_PDF history: one undo/redo restores the card and preserves ink', () => {
  const n = notebook();
  n.lines[0]!.ink = [{ id: 'stroke', points: [{ x: 10, y: 20, t: 1, p: 1 }] }];
  const before = structuredClone(n);
  notebookStore.getState().load(n, 1);
  const problem = prepareQuestionProblem(page, source(n), selection());
  notebookStore.getState().commit('IMPORT_PDF', (snap) => questionImportSnapshot(snap, problem));
  assert.equal(notebookStore.getState().past.length, 1);
  assert.deepEqual(notebookStore.getState().notebook!.lines, before.lines);
  assert.equal(notebookStore.getState().notebook!.problem.origin?.name, 'test_questioncard.pdf');
  assert.ok(notebookStore.getState().undo());
  assert.deepEqual(notebookStore.getState().notebook!.problem, before.problem);
  assert.deepEqual(notebookStore.getState().notebook!.lines, before.lines);
  assert.ok(notebookStore.getState().redo());
  assert.deepEqual(notebookStore.getState().notebook!.problem, problem);
  assert.deepEqual(notebookStore.getState().notebook!.lines, before.lines);
});
test('explicit selection is required; unreadable or invented premises cannot be adopted', () => {
  const r = normalizeQuestionPage({ complete: true, lines: [{ id: 'a', segments: [{ type: 'math', content: 'a>0' }], has_unreadable: false }], questions: [{ id: 'q', label: '1', title: 'Test', line_ids: ['a'], unknowns: ['a'], independent_var: '', functions: [], premises: [{ id: 'p', kind: 'assumption', latex: 'a>0', source_line_ids: ['a'] }] }] }, 1, 'ai');
  const s = { ...selection(), questionId: 'q', statement: '$a>0$', unknowns: 'a' };
  assert.deepEqual(prepareQuestionProblem(r, source(), s).assumptions, []);
  assert.equal(prepareQuestionProblem(r, source(), { ...s, premiseIds: ['p'] }).assumptions[0]!.kind, 'positive');
  r.lines[0]!.has_unreadable = true;
  assert.throws(() => prepareQuestionProblem(r, source(), { ...s, premiseIds: ['p'] }), /PREMISE_INVALID/);
});
test('retains unparsed edits as text/math for review and rejects malformed delimiters/symbols', () => {
  assert.equal(parseStatement('説明だけ', []).length, 1);
  assert.throws(() => parseStatement('途中 $x', []), /STATEMENT_INVALID/);
  assert.throws(() => prepareQuestionProblem(page, source(), { ...selection(), unknowns: 'x + 1' }), /SYMBOL_INVALID/);
});
test('only a card change or notebook switch invalidates an in-flight import, not new ink', () => {
  const n = notebook(); const initial = source(n);
  n.lines[0]!.version++; assert.ok(canAdoptQuestion(n, initial));
  n.problem.title = 'Edited'; assert.ok(!canAdoptQuestion(n, initial));
  assert.ok(!canAdoptQuestion(notebook(), initial));
});
