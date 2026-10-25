import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphFromWire, graphOf, GraphWireSchema, type GraphWire } from '@mn/contracts';

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
