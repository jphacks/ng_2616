import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromWire, graphOf, GraphWireSchema, type GraphWire, type SuggestInput } from '@mn/contracts';
import { scriptedRecognition, scriptedSuggestion } from '../../src/server/ai/direct/demo';

const wire = (over: Partial<GraphWire> = {}): GraphWire =>
  GraphWireSchema.parse({
    has_graph: true,
    kind: '2d',
    title: 'Particle in a box',
    x_label: '$x$',
    y_label: '$\\psi_n(x)$',
    x_range: [0, 1],
    constants: [{ name: 'L', value: 1 }],
    series: [1, 2, 3].map((n) => ({ type: 'function', y: `\\sqrt{2/L}\\sin(${n}\\pi x/L)`, label: `$n = ${n}$` })),
    ...over,
  });

describe('graph lines: the model describes a graph, our parser reads its formulas', () => {
  it('turns every formula into MathJSON and keeps the LaTeX beside it', () => {
    const out = graphFromWire(wire());
    assert.ok(out.ok);
    assert.equal(out.spec.series.length, 3);
    const y = out.spec.series[0]!.formulas.y!;
    assert.equal(y.latex, '\\sqrt{2/L}\\sin(1\\pi x/L)');
    assert.ok(Array.isArray(y.expr));
    assert.deepEqual(out.spec.constants, { L: 1 });
    assert.deepEqual(out.spec.axes.x.range, [0, 1]);
    assert.equal(out.spec.series[0]!.part, 're');
  });

  it('refuses a formula our parser cannot read, instead of passing it on', () => {
    const out = graphFromWire(wire({ series: [{ type: 'function', y: '\\import{os}' }] }));
    assert.equal(out.ok, false);
  });

  it('refuses a series that is missing the formula its type needs', () => {
    const out = graphFromWire(wire({ series: [{ type: 'parametric', x: '\\cos t' }] }));
    assert.ok(!out.ok && /needs y/.test(out.message));
  });

  it('refuses 3D series on a 2D graph', () => {
    const out = graphFromWire(wire({ series: [{ type: 'surface', z: 'x^2 + y^2' }] }));
    assert.ok(!out.ok && /2d graph/.test(out.message));
  });

  it('gives parametric and polar curves a default parameter, and 3D graphs a default view', () => {
    const polar = graphFromWire(wire({ series: [{ type: 'polar', r: '1 + \\cos\\theta' }] }));
    assert.ok(polar.ok);
    assert.equal(polar.spec.series[0]!.params[0]!.name, 'theta');
    const surface = graphFromWire(wire({ kind: '3d', z_label: 'z', series: [{ type: 'surface', z: 'x^2 - y^2' }] }));
    assert.ok(surface.ok);
    assert.deepEqual(surface.spec.view, { elev: 25, azim: -60 });
    assert.equal(surface.spec.axes.z?.label, 'z');
  });

  it('refuses a range that runs backwards and points with the wrong number of coordinates', () => {
    assert.equal(graphFromWire(wire({ x_range: [2, 1] })).ok, false);
    assert.equal(graphFromWire(wire({ series: [{ type: 'points', points: [[1, 2, 3]] }] })).ok, false);
  });

  it('reads a graph back from a line, and ignores anything that is not one', () => {
    const out = graphFromWire(wire());
    assert.ok(out.ok);
    assert.deepEqual(graphOf({ extensions: { graph: out.spec } }), out.spec);
    assert.equal(graphOf({ extensions: { graph: { kind: '2d' } } }), undefined);
    assert.equal(graphOf({}), undefined);
  });

  it('does not draw when the model declines', () => {
    assert.equal(graphFromWire(wire({ has_graph: false })).ok, false);
  });
});

describe('graph lines in the scripted demo', () => {
  const input = (over: Partial<SuggestInput> = {}): SuggestInput => ({
    context: { lines: [] },
    mode: 'GRAPH',
    based_on_line_id: 'L1',
    target_line_id: 'L2',
    rejected_hashes: [],
    ui_lang: 'en',
    ...over,
  });

  it('reads a line written after the script as a request for a graph', () => {
    const r = scriptedRecognition({ image: { mime: 'image/png', data: '' }, ui_lang: 'en', user_line_index: 99 });
    assert.equal(r.graph_request, true);
    assert.equal(r.route, 'none');
    assert.ok(r.segments.some((s) => s.type === 'text' && s.text.startsWith('Plot')));
  });

  it('answers the request with a graph line: the title as words, three curves as the picture', async () => {
    const r = await scriptedSuggestion(input(), new AbortController().signal);
    assert.equal(r.state, 'GENERATED');
    const line = r.candidate!.lines[0]!;
    assert.equal(r.candidate!.mode, 'GRAPH');
    assert.equal(line.target.role, 'text');
    assert.deepEqual(line.segments, [{ type: 'text', text: line.graph!.title }]);
    assert.equal(line.graph!.series.length, 3);
    assert.deepEqual(line.graph!.constants, { L: 1 });
  });

  it('does not offer a graph the student dismissed', async () => {
    const first = await scriptedSuggestion(input(), new AbortController().signal);
    const again = await scriptedSuggestion(input({ rejected_hashes: [first.candidate!.content_hash] }), new AbortController().signal);
    assert.equal(again.state, 'NONE');
  });
});
