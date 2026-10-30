import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromWire, segmentsFromSource, type Line, type Notebook, type PdfDocument } from '@mn/contracts';
import { exportSnapshot, serializeNotebook } from '../../src/core/export/document';
import { escapeTex, serializeLatex } from '../../src/core/export/latex';

// a 1×1 PNG: enough for the schema, which only accepts real PNG data
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const spec = () => {
  const out = graphFromWire({ has_graph: true, kind: '2d', title: 'A sine wave', x_label: '$x$', y_label: '$y$', x_range: [0, 6], series: [{ type: 'function', y: '\\sin x' }] });
  assert.ok(out.ok);
  return out.spec;
};

const notebook = (): Notebook => ({
  schema_version: '2.2.0',
  id: '00000000-0000-4000-8000-0000000000aa',
  title: 'Graphs',
  mode: 'live',
  domain: 'Reals',
  recoveries: [],
  lines: [
    { id: 'R1', version: 1, source: 'user', role: 'step', state: 'SETTLED', ink: [], segments: segmentsFromSource('plot $y = \\sin x$'), extensions: { graph_request: true, route: 'none' } },
    { id: 'G1', version: 1, source: 'ai', role: 'text', state: 'SETTLED', ink: [], segments: [{ type: 'text', text: 'A sine wave' }], ai_origin: { candidate_id: 'c', mode: 'GRAPH' }, extensions: { graph: spec() } },
  ] as Line[],
});

const doc = (png: string): PdfDocument => ({
  title: 'Report', language: 'en',
  homework: { course: '', institution: '', date: '', exercise: '1', paper: 'letter', include_records: true },
  sections: [{ title: 'Derivation', blocks: [{ label: '2', fragments: [{ kind: 'text', value: 'A sine wave' }], notes: ['graph'], image: { png, width: 1, height: 1 } }] }],
});

describe('graph lines in the PDF export', () => {
  it('keeps a graph and a request through the export snapshot, and gives the graph block its picture', () => {
    const snap = exportSnapshot(notebook());
    const { document } = serializeNotebook(snap, 'en', undefined, { G1: { png: PNG, width: 1, height: 1 } });
    const [request, graph] = document.sections.at(-1)!.blocks;
    assert.ok(request!.notes.includes('Request for a graph (not checked)'));
    assert.equal(graph!.image?.png, PNG);
    assert.ok(graph!.notes.includes('Graph drawn from the notebook (not a checked statement)'));
    assert.ok(graph!.notes.includes('AI-assisted'));
  });

  it('says so when a graph could not be drawn for the export', () => {
    const { document } = serializeNotebook(exportSnapshot(notebook()), 'ja');
    const graph = document.sections.at(-1)!.blocks[1]!;
    assert.equal(graph.image, undefined);
    assert.ok(graph.notes.includes('このグラフはPDF用に描画できませんでした'));
  });

  it('writes the PNG from the .tex itself once, then includes it, so the file needs nothing beside it', () => {
    const tex = serializeLatex(doc(PNG));
    assert.equal(tex.match(/\\directlua\{mnGraph = function/g)?.length, 1);
    assert.ok(tex.includes(`\\directlua{mnGraph('graph-1.png', '${PNG}')}`));
    assert.ok(tex.includes('\\includegraphics[width=0.82\\linewidth]{graph-1.png}'));
    // the record appendix repeats the block but not the picture data
    assert.equal(tex.split(PNG).length - 1, 1);
  });

  it('leaves out pictures beyond the size budget instead of failing the whole report', () => {
    const big = `iVBORw0KGgo${'A'.repeat(700_000)}`;
    const tex = serializeLatex(doc(big));
    assert.ok(!tex.includes('\\includegraphics'));
    assert.ok(tex.includes('graph omitted: the report is at its size limit'));
  });

  it('refuses anything that is not PNG data where a picture goes', () => {
    assert.throws(() => serializeLatex(doc("'); os.execute('x")));
    assert.throws(() => serializeLatex(doc('R0lGODlhAQABAAAAACw=')));
  });

  it('sets Unicode sub- and superscripts in captions as one formula', () => {
    assert.equal(escapeTex('ψₙ(x)'), '$\\psi_{n}$(x)');
    assert.equal(escapeTex('|ψ|²'), '|$\\psi$|$^{2}$');
    assert.equal(escapeTex('E₁₀'), 'E$_{1}_{0}$');
  });
});
