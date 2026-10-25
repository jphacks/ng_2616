import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeQuestionPage } from '@mn/contracts';
import { changedQuestionMath } from '../../src/core/resources/question-reading';

const reading = (first: string, second = 'x^2=4') => normalizeQuestionPage({ complete: true,
  lines: [first, second].map((content, i) => ({ id: `l${i}`, has_unreadable: false, segments: [{ type: 'math' as const, content }] })),
  questions: [0, 1].map((i) => ({ id: `q${i}`, label: `${i + 1}`, title: `Question ${i + 1}`, line_ids: [`l${i}`], unknowns: [], independent_var: '', functions: [], premises: [] })),
}, 1, 'ai');

test('flags chi changed to x in one question even if another already uses x', () => {
  const original = reading('3\\chi^2-15=0');
  const candidate = reading('3x^2-15=0');
  const before = JSON.stringify(original);
  assert.deepEqual(changedQuestionMath(original, candidate), ['1']);
  assert.equal(JSON.stringify(original), before);
});

test('matches printed labels despite new IDs and question order, without calling equivalent notation a symbol change', () => {
  const original = reading('3\\chi^2-15=0');
  const candidate = reading('3\\chi^{2}-15=0');
  candidate.questions.reverse();
  candidate.questions[1]!.id = 'different';
  candidate.questions[1]!.label = '（１）';
  assert.deepEqual(changedQuestionMath(original, candidate), []);
});

test('flags a changed coefficient or sign even when variable names match', () => {
  const original = reading('3x^2-15=0');
  assert.deepEqual(changedQuestionMath(original, reading('3x^2+15=0')), ['1']);
  assert.deepEqual(changedQuestionMath(original, reading('2x^2-15=0')), ['1']);
});
