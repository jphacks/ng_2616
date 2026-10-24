import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Line, Notebook, Proof } from '@mn/contracts';
import { segmentsFromSource } from '@mn/contracts';
import { inputHash, payloadForLine } from '../../src/core/cas/payload';
import { exportSnapshot, serializeNotebook, validateExportSnapshot } from '../../src/core/export/document';
import { buildNotebook } from '../../src/core/presets';
import { pdfFileName, textChunks } from '../../src/core/export/browser-pdf';

function addLine(nb: Notebook, status: Proof['status'], extra: Partial<Line> = {}, ancestors: string[] = []): Line {
  const l: Line = { id: `L${nb.lines.length}`, version: 1, state: 'SETTLED', source: 'user', role: 'step', ink: [], segments: segmentsFromSource('$x = 2$'), ...extra };
  nb.lines.push(l);
  const hash = inputHash(nb, payloadForLine(nb, l.id), 'test-cas');
  l.verified = { verification_id: `V${l.id}`, input_hash: hash, proof: {
    status, conditions: [], evidence: [], hints: [], segment_results: [], depends_on: [], depends_on_unverified: !!ancestors.length, unverified_ancestors: ancestors,
    input_hash: hash, mock: false, cas: { version: 'test-cas', rules_version: '2.0.0', elapsed_ms: 1, timed_out: false },
  } };
  return l;
}

function fixture() { const n = buildNotebook('expansion', 'ja'); n.lines = []; return n; }
const resultText = (n: Notebook) => JSON.stringify(serializeNotebook(n, 'ja').document);

describe('PDF document snapshot', () => {
  it('uses a separate report title and optional author/student ID without renaming the notebook', () => {
    const n = fixture();
    const document = serializeNotebook(n, 'ja', { title: '積分のレポート', author: '山田 太郎', studentId: '12345678' }).document;
    assert.equal(document.title, '積分のレポート');
    assert.equal(document.author, '山田 太郎');
    assert.equal(document.student_id, '12345678');
    assert.notEqual(n.title, document.title);
  });
  it('preserves all four statuses, local verification, source and explicitly unverified AI adoption', () => {
    const n = fixture();
    const parent = addLine(n, 'unknown');
    addLine(n, 'ok', {}, [parent.id]);
    addLine(n, 'wrong');
    addLine(n, 'none');
    addLine(n, 'ok', { ai_origin: { candidate_id: 'c', mode: 'COMPLETE_RHS', unverified_adoption: true }, source: 'user' });
    addLine(n, 'none', { source: 'pdf', role: 'premise', document_origin: { name: '演習.pdf', page: 2, has_unreadable: true } });
    const text = resultText(n);
    for (const expected of ['確認不能', '局所変形は整合', '誤り', '検証対象外', '未検証のAI候補を採用', '前提（問題として与えられた内容・検証対象外）', '演習.pdf', 'p.2', '未読箇所あり']) assert.ok(text.includes(expected), expected);
  });

  it('does not call a result verified after the given lines change', () => {
    const n = fixture(); addLine(n, 'ok');
    assert.ok(resultText(n).includes('検証済み'));
    n.lines.unshift({ id: 'given-x', version: 1, state: 'SETTLED', source: 'user', role: 'premise', ink: [], segments: segmentsFromSource('$x>0$') });
    assert.ok(resultText(n).includes('現在の前提では未検証'));
    assert.ok(!resultText(n).includes('検証済み'));
  });

  it('retains revisions in an appendix and marks unfinished work without fabricating math', () => {
    const n = fixture();
    addLine(n, 'wrong', { state: 'SUPERSEDED', superseded_by: 'L1' });
    addLine(n, 'ok');
    n.lines.push({ id: 'draft', version: 2, state: 'RECOGNIZING', source: 'user', role: 'step', ink: [], segments: [] });
    const result = serializeNotebook(n, 'ja');
    assert.equal(result.omitted, 1);
    assert.equal(result.document.sections.at(-1)?.title, '修正履歴');
    assert.ok(JSON.stringify(result.document).includes('修正済み'));
    assert.ok(JSON.stringify(result.document).includes('未確定行'));
  });

  it('separates opening givens and keeps later givens in their original scope', () => {
    const n = fixture();
    addLine(n, 'none', { role: 'premise', segments: segmentsFromSource('$a>0$') });
    const first = addLine(n, 'ok');
    const later = addLine(n, 'none', { role: 'premise', segments: segmentsFromSource('$a<0$') });
    addLine(n, 'ok');
    const sections = serializeNotebook(n, 'en').document.sections;
    assert.equal(sections[0]!.title, 'Problem');
    assert.equal(sections[0]!.blocks.length, 1);
    assert.deepEqual(sections[1]!.blocks.map(b => b.label), [String(n.lines.indexOf(first) + 1), String(n.lines.indexOf(later) + 1), '4']);
  });

  it('preserves PDF question provenance and mock/correction flags through exportSnapshot', () => {
    const n = fixture();
    addLine(n, 'none', { source: 'pdf', role: 'premise', document_origin: { name: 'sheet.pdf', page: 3, has_unreadable: false }, extensions: { pdf_question: { label: '10', mock: true, corrected: true } } });
    const text = JSON.stringify(serializeNotebook(exportSnapshot(n), 'en').document);
    for (const expected of ['sheet.pdf', 'p.3', 'Question 10', 'MOCK', 'corrected by user']) assert.ok(text.includes(expected), expected);
  });

  it('regenerates math from IR and keeps arbitrary recognition/HTML strings as literal text', () => {
    const n = fixture();
    addLine(n, 'unknown', { segments: [{ type: 'math', expr: ['Unparsed', '\\input{secret}<img src=x onerror=alert(1)>'], notation: 'plain', latex: '\\directlua{bad}' }] });
    addLine(n, 'ok', { segments: [{ type: 'math', expr: ['Equal', 'x', 2], notation: 'plain', latex: '\\input{bad}' }] });
    const blocks = serializeNotebook(n, 'ja').document.sections.find(s => s.title === '導出')!.blocks;
    assert.equal(blocks[0]!.fragments[0]!.kind, 'text');
    assert.equal(blocks[1]!.fragments[0]!.value, 'x = 2');
    assert.ok(!JSON.stringify(blocks).includes('directlua'));
  });

  it('is deterministic and never changes source notebook/history, retaining scripted provenance', () => {
    const n = buildNotebook('schrodinger', 'ja');
    const before = structuredClone(n);
    const a = exportSnapshot(n);
    const out = serializeNotebook(a, 'ja');
    assert.deepEqual(out, serializeNotebook(exportSnapshot(n), 'ja'));
    assert.deepEqual(n, before);
    assert.ok(JSON.stringify(out.document).includes('模擬・台本'));
    assert.equal(out.omitted, 0, 'an empty cursor is not omitted work');
  });

  it('rejects invalid IR and bounds document depth and number of lines', () => {
    const n = fixture(); addLine(n, 'ok', { segments: [{ type: 'math', expr: ['Execute', 'bad'], notation: 'plain', latex: 'x' }] });
    assert.throws(() => serializeNotebook(n, 'en'), /IR_INVALID/);
    const deep: unknown[] = []; let cursor = deep;
    for (let i = 0; i < 50; i++) { const next: unknown[] = []; cursor.push(next); cursor = next; }
    assert.throws(() => validateExportSnapshot(deep), /EXPORT_TOO_LARGE/);
    n.lines = Array.from({ length: 501 }, (_, i) => ({ ...n.lines[0]!, id: `L${i}` }));
    assert.throws(() => validateExportSnapshot(n), /EXPORT_TOO_LARGE/);
  });
});

describe('browser PDF helpers', () => {
  it('creates a safe, readable download filename', () => {
    assert.equal(pdfFileName('演習 / 1.pdf'), '演習 - 1.pdf');
    assert.equal(pdfFileName(' .. '), 'notebook.pdf');
  });
  it('chunks long paragraphs without losing whitespace, symbols or surrogate pairs', () => {
    const value = '日本語の問題。\n\n' + 'A 😀 _ & '.repeat(400);
    const chunks = textChunks(value);
    assert.equal(chunks.join(''), value);
    assert.ok(chunks.every((p) => Array.from(p).length <= 500));
  });
});
