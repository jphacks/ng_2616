import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PdfDocument } from '@mn/contracts';
import { serializeLatex, escapeTex } from '../../src/core/export/latex';
import { serializeNotebook } from '../../src/core/export/document';
import { buildNotebook } from '../../src/core/presets';

const fixture = (): PdfDocument => ({
  title: '積分の課題', author: '山田 太郎', student_id: '12345678', language: 'ja',
  homework: { course: '数理物理学 I', institution: 'Example University', date: '2026/10/25', exercise: '2', paper: 'letter', include_records: true },
  sections: [{ title: '導出', blocks: [
    { label: '1', fragments: [{ kind: 'text', value: '条件 ' }, { kind: 'math', value: 'a > 0' }], notes: [] },
    { label: '2', fragments: [{ kind: 'math', value: 'x = 2' }], notes: ['未検証のAI候補を採用'] },
  ] }, { title: '修正履歴', blocks: [{ label: '0', fragments: [{ kind: 'math', value: 'x = 3' }], notes: ['修正済み'] }] }],
});

describe('LuaLaTeX homework report', () => {
  it('adapts the supplied layout with notebook content and editable report metadata', () => {
    const doc = fixture(); const before = structuredClone(doc);
    const tex = serializeLatex(doc);
    for (const expected of ['letterpaper,top=20mm,bottom=30mm,left=26mm,right=30mm', '数理物理学 I', '山田 太郎', '12345678', '積分の課題', '設問 2.', 'x = 2', '検証記録・修正履歴']) assert.ok(tex.includes(expected), expected);
    for (const sample of ['Jeffrey Zhang', 'MP1 2024 A2', 'rowoperations', 'figures/']) assert.ok(!tex.includes(sample));
    assert.equal(tex, serializeLatex(doc)); assert.deepEqual(doc, before);
  });
  it('keeps history out of the submitted derivation and makes the record appendix optional', () => {
    const doc = fixture();
    const [body, appendix] = serializeLatex(doc).split('\\clearpage');
    assert.ok(!body!.includes('x = 3')); assert.ok(appendix!.includes('x = 3'));
    doc.homework!.include_records = false; doc.homework!.paper = 'a4';
    const tex = serializeLatex(doc);
    assert.ok(tex.includes('a4paper')); assert.ok(!tex.includes('x = 3')); assert.ok(!tex.includes('未検証のAI候補'));
  });
  it('escapes all text and rejects executable commands masquerading as math', () => {
    const doc = fixture();
    doc.title = '\\input{secret} $ & # % _ ^ ~';
    assert.ok(serializeLatex(doc).includes(escapeTex(doc.title)));
    assert.ok(!serializeLatex(doc).includes('\\input{secret}'));
    doc.sections[0]!.blocks[0]!.fragments = [{ kind: 'math', value: '\\directlua{os.execute("bad")}' }];
    assert.throws(() => serializeLatex(doc), /IR_INVALID/);
  });
  it('supports the existing notebook presets without changing the notebook', () => {
    for (const preset of ['expansion', 'integral', 'schrodinger'] as const) {
      const nb = buildNotebook(preset, 'ja'); const before = structuredClone(nb);
      assert.ok(serializeLatex(serializeNotebook(nb, 'ja').document).endsWith('\\end{document}\n'));
      assert.deepEqual(nb, before);
    }
  });
});
