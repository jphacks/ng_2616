import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeQuestionPage, segmentsFromSource, type Line } from '@mn/contracts';
import { payloadForLine } from '../../src/core/cas/payload';
import { buildNotebook } from '../../src/core/presets';
import { prepareQuestionLines, statementSource } from '../../src/core/resources/question-adoption';

test('the imported integral is a calculation base without changing its notebook Given mark', () => {
  const page = normalizeQuestionPage({ complete: true,
    lines: [{ id: 'l', has_unreadable: false, segments: [{ type: 'math', content: '\\int_1^2 \\frac{3x^2+5x+4}{x(x^2+1)}\\,dx' }] }],
    questions: [{ id: 'q', label: '', title: 'Integral', line_ids: ['l'], unknowns: [], independent_var: '', functions: [], premises: [] }],
  }, 1, 'ai');
  const nb = buildNotebook('blank', 'en');
  const imported = prepareQuestionLines(page, { fileName: 'integral-worksheet.pdf', notebookId: nb.id, contextHash: '' }, { questionId: 'q', title: 'Integral', statement: statementSource(page, 'q'), premiseIds: [] });
  const step: Line = { id: 'step', version: 1, state: 'SETTLED', source: 'user', role: 'step', ink: [], segments: segmentsFromSource('$\\int_1^2 (4/x-x/(x^2+1)+5/(x^2+1))\\,dx$') };
  nb.lines = [...imported, step];
  const before = JSON.stringify(nb);
  const payload = payloadForLine(nb, step.id);
  assert.equal(payload.parent_id, imported[0]!.id);
  assert.equal(payload.lines[0]!.role, 'step');
  assert.equal(imported[0]!.role, 'premise');
  assert.equal(JSON.stringify(nb), before);
  // Ordinary given symbols and equations retain their original assumption semantics.
  imported[0]!.segments = segmentsFromSource('$x$');
  assert.equal(payloadForLine(nb, step.id).lines[0]!.role, 'premise');
  imported[0]!.segments = segmentsFromSource('$x=2$');
  assert.equal(payloadForLine(nb, step.id).lines[0]!.role, 'premise');
});
