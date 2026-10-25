import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quadraticQuestionFixture } from '@mn/contracts/fixtures';
import { normalizeQuestionPage, NotebookSchema } from '@mn/contracts';
import { buildNotebook } from '../../src/core/presets';
import { notebookStore } from '../../src/core/store/notebook-store';
import { canAdoptQuestion, parseStatement, prepareQuestionLines, questionContextHash, questionImportSnapshot, statementSource, type QuestionSelection } from '../../src/core/resources/question-adoption';

const page = quadraticQuestionFixture();
const notebook = () => buildNotebook('blank', 'ja');
const selection = (id = 'Q1'): QuestionSelection => ({ questionId: id, title: '問1', statement: statementSource(page, id), premiseIds: [] });
const source = (n = notebook()) => ({ fileName: 'test_questioncard.pdf', notebookId: n.id, contextHash: questionContextHash(n) });
const conditionPage = () => normalizeQuestionPage({ complete: true, lines: [
  { id: 'a', segments: [{ type: 'math', content: 'a>0' }], has_unreadable: false },
  { id: 'b', segments: [{ type: 'math', content: 'x^2=a' }], has_unreadable: false },
], questions: [{ id: 'q', label: '1', title: 'Test', line_ids: ['a','b'], unknowns: ['x'], independent_var: '', functions: [], premises: [{ id: 'p', kind: 'assumption', latex: 'a>0', source_line_ids: ['a'] }] }] }, 1, 'ai');

test('imports ordinary given lines with source and chi, never inventing assumptions', () => {
  const lines = prepareQuestionLines(page, source(), selection('Q10'));
  assert.ok(lines.some(l => l.role === 'premise' && JSON.stringify(l.segments).includes('chi')));
  assert.ok(!JSON.stringify(lines).includes('Greater'));
  assert.equal(lines[0]!.document_origin?.page, 1);
  assert.equal((lines[0]!.extensions!.pdf_question as { label: string }).label, '10');
  assert.ok(lines.every(l => l.source === 'pdf'));
});

test('one existing IMPORT_PDF undo/redo restores all lines, ink and draft position', () => {
  const n = notebook();
  n.lines[0]!.ink = [{ id: 'stroke', points: [{ x: 10, y: 20, t: 1, p: 1 }] }];
  const before = structuredClone(n);
  notebookStore.getState().load(n, 1);
  const imported = prepareQuestionLines(page, source(n), selection());
  notebookStore.getState().commit('IMPORT_PDF', snap => questionImportSnapshot(snap, imported));
  const after = structuredClone(notebookStore.getState().notebook!);
  assert.equal(notebookStore.getState().past.length, 1);
  assert.deepEqual(after.lines.at(-1), before.lines[0]);
  assert.equal(after.title, before.title);
  assert.ok(!('problem' in NotebookSchema.parse(after)));
  assert.ok(notebookStore.getState().undo());
  assert.deepEqual(notebookStore.getState().notebook, before);
  assert.ok(notebookStore.getState().redo());
  assert.deepEqual(notebookStore.getState().notebook, after);
});

test('unchecked source assumptions are absent from the editable body and CAS lines', () => {
  const p = conditionPage();
  const s = { ...selection(), questionId: 'q', statement: statementSource(p, 'q') };
  assert.ok(!s.statement.includes('>'));
  assert.ok(!JSON.stringify(prepareQuestionLines(p, source(), s)).includes('Greater'));
  const adopted = prepareQuestionLines(p, source(), { ...s, premiseIds: ['p'] });
  assert.ok(adopted.some(l => l.role === 'premise' && JSON.stringify(l.segments).includes('Greater')));
  p.lines[0]!.has_unreadable = true;
  assert.throws(() => prepareQuestionLines(p, source(), { ...s, premiseIds: ['p'] }), /PREMISE_INVALID/);
});

test('unreadable formulas are visible text, never executable premises or declarations', () => {
  const lines = prepareQuestionLines(page, source(), { ...selection(), statement: '$x>\\square$' });
  assert.ok(lines.every(l => l.role === 'text' && l.segments.every(s => s.type === 'text')));
  assert.ok(lines[0]!.document_origin?.has_unreadable);
  assert.throws(() => parseStatement('途中 $x', []), /STATEMENT_INVALID/);
});

test('new ink may arrive during review, but settled context and notebook switches invalidate it', () => {
  const n = notebook(); const initial = source(n);
  n.lines[0]!.version++; assert.ok(canAdoptQuestion(n, initial));
  n.lines[0]!.state = 'SETTLED';
  assert.ok(!canAdoptQuestion(n, initial));
  assert.ok(!canAdoptQuestion(notebook(), initial));
});

test('insertion keeps prior derivations and draft ink, invalidating only later proofs', () => {
  const n = buildNotebook('solutions', 'en');
  const imported = prepareQuestionLines(page, source(n), selection());
  const snap = { lines: n.lines, recoveries: n.recoveries, activeLineId: n.lines.at(-1)!.id };
  const next = questionImportSnapshot(snap, imported);
  assert.deepEqual(next.lines[0], n.lines[0]);
  assert.deepEqual(next.lines.at(-1), n.lines.at(-1));
  assert.equal(next.activeLineId, snap.activeLineId);
  assert.throws(() => questionImportSnapshot(snap, [n.lines[0]!]), /CONTEXT_CHANGED/);
});
