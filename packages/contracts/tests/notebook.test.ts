import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotebookSchema, SCHEMA_VERSION, declaredFunctions, reparseSegments, segmentsFromSource, type Line } from '../src';
import { parseMathLatex, printLatex, type MathJSON } from '../src/ir';

const ex = (latex: string) => {
  const r = parseMathLatex(latex);
  if (!r.ok) throw new Error(`${latex}: ${r.error.message}`);
  return r.expr;
};

describe('declaration notation (v2.2)', () => {
  const cases: [string, MathJSON][] = [
    ['n \\in \\mathbb{Z}^+', ['Element', 'n', 'PositiveIntegers']],
    ['n \\in \\mathbb{Z}_{>0}', ['Element', 'n', 'PositiveIntegers']],
    ['n ∈ ℤ⁺', ['Element', 'n', 'PositiveIntegers']],
    ['k \\in \\mathbb{Z}', ['Element', 'k', 'Integers']],
    ['x \\in \\mathbb{R}', ['Element', 'x', 'Reals']],
    ['\\Psi(x,t)', ['Apply', 'Psi', 'x', 't']],
    ['V(x)', ['Apply', 'V', 'x']],
    ['\\psi(x) \\neq 0', ['NotEqual', ['Apply', 'psi', 'x'], 0]],
    ['I(a) = \\int_0^a x \\, dx', ['Equal', ['Apply', 'I', 'a'], ['Integrate', 'x', ['Tuple', 'x', 0, 'a']]]],
    ['V(x)\\Psi', ['Multiply', 'V', 'x', 'Psi']],
  ];
  for (const [latex, expected] of cases) {
    it(latex, () => {
      const e = ex(latex);
      assert.deepEqual(e, expected);
      assert.deepEqual(ex(printLatex(e)), e, 'round-trip');
    });
  }

  it('rejects number sets outside "\\in"', () => {
    assert.equal(parseMathLatex('x + \\mathbb{Z}').ok, false);
    assert.equal(parseMathLatex('n \\in \\mathbb{Q}').ok, false);
  });
});

const settled = (id: string, src: string): Line => ({ id, version: 1, source: 'user', role: 'step', state: 'SETTLED', ink: [], segments: segmentsFromSource(src) });

describe('function declarations hold for the whole page', () => {
  it('collects lone applications, first one per name', () => {
    const lines = [settled('L1', '$\\Psi(x,t)$'), settled('L2', '$x + 1$'), settled('L3', '$V(x)$'), settled('L4', '$\\Psi(x)$')];
    assert.deepEqual(declaredFunctions(lines), [{ name: 'Psi', args: ['x', 't'] }, { name: 'V', args: ['x'] }]);
  });

  it('re-reads a line written above the declaration', () => {
    const latex = 'i\\hbar \\frac{\\partial \\Psi}{\\partial t} = V(x)\\Psi';
    const tdse = settled('L1', `$${latex}$`);
    const functions = declaredFunctions([tdse, settled('L2', '$\\Psi(x,t)$'), settled('L3', '$V(x)$')]);
    const declared = parseMathLatex(latex, { functions });
    assert.ok(declared.ok);
    assert.notDeepEqual(ex(latex), declared.expr, 'without the declarations Ψ is a symbol and V(x) a product');
    const reread = reparseSegments(tdse.segments, functions);
    assert.deepEqual(reread[0]!.type === 'math' && reread[0]!.expr, declared.expr);
    // reading again with the same declarations changes nothing
    assert.equal(reparseSegments(reread, functions), reread);
  });
});

describe('pre-v2.2 snapshots', () => {
  const legacy = {
    schema_version: '2.0.0',
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Old',
    mode: 'live',
    domain: 'Reals',
    problem: {
      id: 'p',
      title: 'Card title',
      statement: segmentsFromSource('Solve $x^2 = 4$.'),
      definitions: [['Equal', ['Apply', 'f', 'x'], ['Power', 'x', 2]]],
      conditions: [['Equal', 'y', 1]],
      assumptions: [
        { symbol: 'm', kind: 'positive', source: 'user' },
        { symbol: 'n', kind: 'positive_integer', source: 'user' },
        { symbol: 'psi', kind: 'nonzero', expr: ['Apply', 'psi', 'x'], source: 'user' },
        { symbol: 'x', kind: 'interval', lower: 0, upper: 'L', source: 'user' },
      ],
      unknowns: ['x'],
      functions: [{ name: 'f', args: ['x'] }],
    },
    lines: [{ id: 'L1', version: 1, source: 'user', role: 'step', state: 'DRAFT', ink: [], segments: [] }],
    recoveries: [],
  };

  it('turns the problem card into given lines above the old lines', () => {
    const nb = NotebookSchema.parse(legacy);
    assert.equal(nb.schema_version, SCHEMA_VERSION);
    assert.ok(!('problem' in nb));
    const shown = nb.lines.map((l) => [l.role, l.segments.map((s) => (s.type === 'math' ? s.latex : s.text)).join(' ')]);
    assert.deepEqual(shown, [
      ['premise', 'Solve x^{2} = 4 .'],
      ['premise', 'y = 1'],
      ['definition', 'f\\left(x\\right) = x^{2}'],
      ['premise', 'm > 0'],
      ['premise', 'n \\in \\mathbb{Z}^{+}'],
      ['premise', '\\psi\\left(x\\right) \\ne 0'],
      ['premise', '0 \\le x, x \\le L'],
      ['premise', 'f\\left(x\\right)'],
      ['step', ''],
    ]);
    assert.ok(nb.lines.slice(0, -1).every((l) => l.state === 'SETTLED' && !l.verified));
  });

  it('leaves current snapshots alone', () => {
    const nb = NotebookSchema.parse(legacy);
    assert.deepEqual(NotebookSchema.parse(nb), nb);
  });
});
