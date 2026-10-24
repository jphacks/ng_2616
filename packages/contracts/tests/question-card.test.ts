import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quadraticQuestionFixture } from '../fixtures/question-card';
import { normalizeQuestionPage, questionSegments, QUESTION_PAGE_JSON_SCHEMA, type QuestionPageWire } from '../src/question-card';

function wire(): QuestionPageWire {
  return { complete: true, lines: [{ id: 'a', has_unreadable: false, segments: [{ type: 'math', content: 'a>0' }] }, { id: 'b', has_unreadable: false, segments: [{ type: 'math', content: 'x^2=a' }] }], questions: [{ id: 'q', label: '1', title: 'Problem', line_ids: ['a', 'b'], unknowns: ['x'], independent_var: '', functions: [], premises: [{ id: 'positive', kind: 'assumption', latex: 'a>0', source_line_ids: ['a'] }] }] };
}

test('fixed worksheet has ten separate questions, no fabricated assumptions, and keeps chi', () => {
  const page = quadraticQuestionFixture();
  assert.equal(page.questions.length, 10);
  assert.ok(page.mock);
  for (const q of page.questions) { assert.deepEqual(q.premises, []); assert.deepEqual(q.unknowns, ['chi']); }
  const question = questionSegments(page, page.questions[0]!);
  assert.equal(question[1]!.type, 'math');
  assert.ok(JSON.stringify(question).includes('chi'));
});
test('only source-grounded, readable assumptions can be selected', () => {
  assert.equal(normalizeQuestionPage(wire(), 1, 'ai').questions[0]!.premises[0]!.selectable, true);
  const hallucinated = wire(); hallucinated.questions[0]!.premises[0]!.latex = 'a>1';
  assert.equal(normalizeQuestionPage(hallucinated, 1, 'ai').questions[0]!.premises[0]!.selectable, false);
  const unreadable = wire(); unreadable.lines[0]!.has_unreadable = true;
  assert.equal(normalizeQuestionPage(unreadable, 1, 'ai').questions[0]!.premises[0]!.selectable, false);
});
test('rejects incomplete pages, unknown source references and duplicated IDs', () => {
  assert.throws(() => normalizeQuestionPage({ ...wire(), complete: false }, 1, 'ai'), /INCOMPLETE/);
  const missing = wire(); missing.questions[0]!.line_ids = ['missing'];
  assert.throws(() => normalizeQuestionPage(missing, 1, 'ai'), /SCHEMA_INVALID/);
  const duplicate = wire(); duplicate.lines.push(duplicate.lines[0]!);
  assert.throws(() => normalizeQuestionPage(duplicate, 1, 'ai'), /SCHEMA_INVALID/);
});

test('provider shape avoids nested decoder limits while responses still enforce size and symbol limits', () => {
  assert.doesNotMatch(JSON.stringify(QUESTION_PAGE_JSON_SCHEMA), /"(?:maxItems|minItems|maxLength|minLength)":/);
  const oversized = wire();
  oversized.lines = Array.from({ length: 101 }, (_, i) => ({ ...oversized.lines[0]!, id: `L${i}` }));
  assert.throws(() => normalizeQuestionPage(oversized, 1, 'ai'));
  const invalidSymbol = wire(); invalidSymbol.questions[0]!.unknowns = ['not a symbol'];
  assert.throws(() => normalizeQuestionPage(invalidSymbol, 1, 'ai'));
  const longText = wire(); longText.lines[0]!.segments[0]!.content = 'x'.repeat(4001);
  assert.throws(() => normalizeQuestionPage(longText, 1, 'ai'));
});

test('a confirmed printed question label is text, while ordinary formula parentheses remain math', () => {
  const labeled = wire();
  labeled.lines[1]!.segments[0]!.content = '(1)\\quad x^2=a';
  const page = normalizeQuestionPage(labeled, 1, 'ai');
  assert.equal(page.lines[1]!.segments[0]!.type, 'text');
  assert.deepEqual(page.lines[1]!.segments[1], normalizeQuestionPage(wire(), 1, 'ai').lines[1]!.segments[0]);
  const formula = wire();
  formula.lines[1]!.segments[0]!.content = '(1) x^2=a';
  const math = normalizeQuestionPage(formula, 1, 'ai').lines[1]!.segments;
  assert.equal(math.length, 1);
  assert.equal(math[0]!.type, 'math');
  const otherLabel = wire();
  otherLabel.lines[1]!.segments[0]!.content = '(2)\\quad x^2=a';
  assert.equal(normalizeQuestionPage(otherLabel, 1, 'ai').lines[1]!.segments.length, 1);
});
