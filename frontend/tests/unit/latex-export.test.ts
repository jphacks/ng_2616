import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Notebook, PdfDocument } from '@mn/contracts';
import { serializeLatex, escapeTex } from '../../src/core/export/latex';
import { safeRawMath } from '../../src/core/export/raw-math';
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
  it('typesets proof notation outside the IR (\\min, \\forall, \\Rightarrow) instead of printing its source', () => {
    const nb = buildNotebook('epsilon_delta', 'en');
    const raw = (latex: string) => ({ type: 'math' as const, expr: ['Unparsed', latex] as ['Unparsed', string], notation: 'plain' as const, latex });
    const line = (id: string, segments: Notebook['lines'][number]['segments']) => ({ ...nb.lines[0]!, id, role: 'step' as const, segments });
    nb.lines.splice(nb.lines.length - 1, 0,
      line('l1', [{ type: 'text', text: 'Choose ' }, raw('\\delta = \\min \\left( 1, \\frac{\\varepsilon}{5} \\right)')]),
      line('l2', [raw('\\forall \\varepsilon > 0 \\, \\exists \\delta > 0')]),
      line('l3', [raw('|x - 2| < 1 \\Rightarrow |x + 2| < 5')]));
    const tex = serializeLatex(serializeNotebook(nb, 'en').document);
    assert.ok(tex.includes('Choose $\\delta = \\min \\left( 1, \\frac{\\varepsilon}{5} \\right)$'), tex);
    assert.ok(tex.includes('\\ReportEquation{\\forall \\varepsilon > 0 \\, \\exists \\delta > 0}'));
    assert.ok(tex.includes('\\ReportEquation{|x - 2| < 1 \\Rightarrow |x + 2| < 5}'));
    assert.ok(!tex.includes('\\textbackslash{}delta'));
  });
  it('keeps raw notation as escaped text unless every token is plain math', () => {
    for (const attack of ['\\input{/etc/passwd}', '\\min ^^5cinput{x}', '\\def\\x{1} x', '\\catcode`\\@=11', 'x % comment', 'a & b', '\\frac{1}{2', '\\left( x', '\\text{a^b}', '\\directlua{os.exit()}', 'x \\\\ y']) {
      assert.equal(safeRawMath(attack), null, attack);
    }
    assert.equal(safeRawMath('δ = min(1, ε/5)'), '\\delta = min(1, \\varepsilon /5)');
    assert.equal(safeRawMath('x \\lt 2'), 'x < 2');
    assert.equal(safeRawMath('\\forall x \\text{ with } x > 0'), '\\forall x \\text{ with } x > 0');
  });
  it('supports the existing notebook presets without changing the notebook', () => {
    for (const preset of ['expansion', 'integral', 'schrodinger'] as const) {
      const nb = buildNotebook(preset, 'ja'); const before = structuredClone(nb);
      assert.ok(serializeLatex(serializeNotebook(nb, 'ja').document).endsWith('\\end{document}\n'));
      assert.deepEqual(nb, before);
    }
  });
});
