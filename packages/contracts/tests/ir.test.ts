import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMathLatex, printLatex, printSegmentLatex, validateExpr, type MathJSON, type ParseOptions } from '../src/ir';
import { canonicalJson, hashOf } from '../src/hash';
import { freeSymbols } from '../src/ir/validate';
import { hasUnparsed, wireToSegments } from '../src/segments';

const PHYS: ParseOptions = {
  functions: [
    { name: 'Psi', args: ['x', 't'] },
    { name: 'psi', args: ['x'] },
    { name: 'phi', args: ['t'] },
    { name: 'V', args: ['x'] },
  ],
};
const CALC: ParseOptions = { functions: [{ name: 'f', args: ['x'] }, { name: 'I', args: ['a'] }] };

function parse(latex: string, opts: ParseOptions = {}) {
  const r = parseMathLatex(latex, opts);
  if (!r.ok) throw new Error(`${latex}: ${r.error.code} ${r.error.message}`);
  return r;
}

const ex = (latex: string, opts: ParseOptions = {}) => parse(latex, opts).expr;

describe('parseMathLatex: exact IR', () => {
  const cases: [string, MathJSON, ParseOptions?][] = [
    ['(x-2)(x-3)', ['Multiply', ['Subtract', 'x', 2], ['Subtract', 'x', 3]]],
    ['x^2 = 4', ['Equal', ['Power', 'x', 2], 4]],
    ['x = \\pm 2', ['Equal', 'x', ['PlusMinus', 2]]],
    ['I(a) =', ['Equal', ['Apply', 'I', 'a'], null], CALC],
    ['\\int_0^a (3x^2 + 2x) \\, dx', ['Integrate', ['Add', ['Multiply', 3, ['Power', 'x', 2]], ['Multiply', 2, 'x']], ['Tuple', 'x', 0, 'a']]],
    ['\\left[x^3\\right]_0^a', ['Evaluate', ['Power', 'x', 3], ['Tuple', 'x', 0, 'a']]],
    ['\\left. x^2 \\right|_0^1', ['Evaluate', ['Power', 'x', 2], ['Tuple', 'x', 0, 1]]],
    [
      'i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}',
      ['Equal',
        ['Multiply', 'ImaginaryUnit', 'Hbar', ['PartialD', ['Apply', 'Psi'], 't']],
        ['Negate', ['Multiply', ['Divide', ['Power', 'Hbar', 2], ['Multiply', 2, 'm']], ['PartialD', ['PartialD', ['Apply', 'Psi'], 'x'], 'x']]]],
      PHYS,
    ],
    ['\\Psi(x,t) = \\psi(x)\\phi(t)', ['Equal', ['Apply', 'Psi', 'x', 't'], ['Multiply', ['Apply', 'psi', 'x'], ['Apply', 'phi', 't']]], PHYS],
    ['\\phi(t) = e^{-iEt/\\hbar}', ['Equal', ['Apply', 'phi', 't'], ['Exp', ['Negate', ['Divide', ['Multiply', 'ImaginaryUnit', 'E', 't'], 'Hbar']]]], PHYS],
    [
      '\\psi(x) = A\\sin(kx) + B\\cos(kx)',
      ['Equal', ['Apply', 'psi', 'x'], ['Add', ['Multiply', 'A', ['Sin', ['Multiply', 'k', 'x']]], ['Multiply', 'B', ['Cos', ['Multiply', 'k', 'x']]]]],
      PHYS,
    ],
    [
      'E_n = \\frac{n^2\\pi^2\\hbar^2}{2mL^2}',
      ['Equal', 'E_n', ['Divide', ['Multiply', ['Power', 'n', 2], ['Power', 'Pi', 2], ['Power', 'Hbar', 2]], ['Multiply', 2, 'm', ['Power', 'L', 2]]]],
    ],
    ["f'(x) = 2x^2", ['Equal', ['Prime', ['Apply', 'f', 'x'], 1], ['Multiply', 2, ['Power', 'x', 2]]], CALC],
    ['\\frac{d^2\\psi}{dx^2} = -k^2\\psi', ['Equal', ['D', ['D', ['Apply', 'psi'], 'x'], 'x'], ['Negate', ['Multiply', ['Power', 'k', 2], ['Apply', 'psi']]]], PHYS],
    ['\\sqrt{x^2}', ['Sqrt', ['Power', 'x', 2]]],
    ['\\sin^2 x + \\cos^2 x', ['Add', ['Power', ['Sin', 'x'], 2], ['Power', ['Cos', 'x'], 2]]],
    ['2x + 2 < 6', ['Less', ['Add', ['Multiply', 2, 'x'], 2], 6]],
    ['x + y = 3, x - y = 1', ['And', ['Equal', ['Add', 'x', 'y'], 3], ['Equal', ['Subtract', 'x', 'y'], 1]]],
    ['0.5x', ['Multiply', ['Divide', 5, 10], 'x']],
    ['\\square + 1', ['Add', ['Unreadable'], 1]],
    ['|x|', ['Abs', 'x']],
    ['\\lim_{x \\to 0^+} \\frac{\\sin x}{x}', ['Limit', ['Divide', ['Sin', 'x'], 'x'], ['LimitSpec', 'x', 0, 'right']]],
    ['−a·b', ['Negate', ['Multiply', 'a', 'b']]],
  ];
  for (const [latex, expected, opts] of cases) {
    it(latex, () => assert.deepEqual(ex(latex, opts), expected));
  }

  it('continuation keeps the RHS only', () => {
    const r = parse('= x^2 - 5x + 6');
    assert.equal(r.notation, 'continuation');
    assert.deepEqual(r.expr, ['Add', ['Power', 'x', 2], ['Negate', ['Multiply', 5, 'x']], 6]);
  });

  it('sum over modes', () => {
    const e = ex('\\Psi(x,t) = \\sum_{n=1}^{\\infty} c_n \\sin\\left(\\frac{n\\pi x}{L}\\right) e^{-iE_n t/\\hbar}', PHYS);
    assert.deepEqual(e, ['Equal', ['Apply', 'Psi', 'x', 't'],
      ['Sum',
        ['Multiply', 'c_n', ['Sin', ['Divide', ['Multiply', 'n', 'Pi', 'x'], 'L']], ['Exp', ['Negate', ['Divide', ['Multiply', 'ImaginaryUnit', 'E_n', 't'], 'Hbar']]]],
        ['Tuple', 'n', 1, 'Infinity']]]);
  });

  it('does not repair mistakes', () => {
    // the missing 2x term stays missing; the sign error stays a sign error
    assert.deepEqual(ex('\\left[x^3\\right]_0^a'), ['Evaluate', ['Power', 'x', 3], ['Tuple', 'x', 0, 'a']]);
    assert.deepEqual(ex('\\phi(t) = e^{iEt/\\hbar}', PHYS), ['Equal', ['Apply', 'phi', 't'], ['Exp', ['Divide', ['Multiply', 'ImaginaryUnit', 'E', 't'], 'Hbar']]]);
  });
});

describe('parseMathLatex: failures keep ink instead of guessing', () => {
  const bad: [string, string][] = [
    ['', 'EMPTY'],
    ['\\text{hello}', 'UNSUPPORTED_NOTATION'],
    ['n = 1, 2, \\ldots', 'UNSUPPORTED_NOTATION'],
    ['\\int x', 'PARSE_ERROR'],
    ['\\begin{aligned} x \\end{aligned}', 'UNSUPPORTED_NOTATION'],
    ['x \\approx 2', 'UNSUPPORTED_NOTATION'],
    ['(x + 1', 'PARSE_ERROR'],
  ];
  for (const [latex, code] of bad) {
    it(JSON.stringify(latex), () => {
      const r = parseMathLatex(latex);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, code);
    });
  }
});

describe('printLatex round-trip', () => {
  const inputs: [string, ParseOptions?][] = [
    ['(x-2)(x-3)'], ['x^2 - 5x + 6'], ['x^2 - 5x + 5'], ['x^2 = 4'], ['x = 2'], ['x = \\pm 2'],
    ['\\frac{x^2-1}{x-1}'], ['x + 1 + \\frac{1}{10^{12}}'], ['\\frac{x+1}{2} + \\frac{x-1}{2}'],
    ['\\sqrt{x^2}'], ['\\sin^2 x + \\cos^2 x'], ['2x + 2 < 6'], ['x < 2'], ['x \\ge 0'],
    ['x + y = 3, x - y = 1'], ['\\sin(\\pi x)'], ['\\frac{x+1}{x}'], ['a - (b + c)'], ['(a + b) - c'],
    ['-x^2'], ['2 \\cdot (-3)'], ['a(b+c)'], ['\\left|x - 1\\right|'], ['\\{1, 2\\}'],
    ['I(a) = \\int_0^a (3x^2+2x)\\,dx', CALC], ['\\left[x^3 + x^2\\right]_0^a'], ["f'(x) = 2x^2", CALC], ['f(2) = 5', CALC],
    ['V(x) = 0', PHYS],
    ['i\\hbar \\frac{\\partial \\Psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\Psi}{\\partial x^2}', PHYS],
    ['\\Psi(x,t) = \\psi(x)\\phi(t)', PHYS],
    ['i\\hbar \\psi \\frac{d\\phi}{dt} = -\\frac{\\hbar^2}{2m} \\phi \\frac{d^2\\psi}{dx^2}', PHYS],
    ['\\frac{i\\hbar}{\\phi}\\frac{d\\phi}{dt} = -\\frac{\\hbar^2}{2m}\\frac{1}{\\psi}\\frac{d^2\\psi}{dx^2}', PHYS],
    ['-\\frac{\\hbar^2}{2m}\\frac{d^2\\psi}{dx^2} = E\\psi', PHYS],
    ['\\frac{d\\phi}{dt} = -\\frac{iE}{\\hbar}\\phi', PHYS],
    ['\\phi(t) = e^{-iEt/\\hbar}', PHYS],
    ['\\psi(0) = 0, \\psi(L) = 0', PHYS],
    ['k = \\frac{\\sqrt{2mE}}{\\hbar}'],
    ['\\psi(x) = A\\sin(kx) + B\\cos(kx)', PHYS],
    ['k = \\frac{n\\pi}{L}'],
    ['E_n = \\frac{n^2\\pi^2\\hbar^2}{2mL^2}'],
    ['\\Psi(x,t) = \\sum_{n=1}^{\\infty} c_n \\sin\\left(\\frac{n\\pi x}{L}\\right) e^{-iE_n t/\\hbar}', PHYS],
    ['\\frac{d}{dx}(x^2 + 1)'], ['\\lim_{x \\to 0} \\frac{\\sin x}{x}'], ['\\int_0^1 x \\, dx + 1'],
    ['\\psi\\left(a + b\\right)', PHYS], ['\\square = 2'],
    ['|x^2 - 4| = |x - 2||x + 2| < \\frac{\\varepsilon}{5} \\cdot 5 = \\varepsilon'], ['0 < x \\le 1'], ['a = b, b < c'],
  ];
  for (const [latex, opts] of inputs) {
    it(latex, () => {
      const first = parse(latex, opts);
      const printed = printSegmentLatex(first.expr, first.notation);
      const second = parse(printed, opts);
      assert.deepEqual(second.expr, first.expr);
      assert.equal(validateExpr(first.expr), null);
    });
  }

  it('prints readable LaTeX', () => {
    assert.equal(printLatex(ex('\\Psi(x,t) = \\psi(x)\\phi(t)', PHYS)), '\\Psi\\left(x, t\\right) = \\psi\\left(x\\right) \\phi\\left(t\\right)');
    assert.equal(printLatex(ex('\\frac{\\partial^2 \\Psi}{\\partial x^2}', PHYS)), '\\frac{\\partial^{2} \\Psi}{\\partial x^{2}}');
    assert.equal(printLatex(ex('E_n')), 'E_{n}');
  });

  it('prints a mixed chain as written, and a list of separate relations with commas', () => {
    assert.equal(printLatex(ex('a = b < c = d')), 'a = b < c = d');
    assert.equal(printLatex(ex('0 < x \\le 1')), '0 < x \\le 1');
    assert.equal(printLatex(ex('x + y = 3, x - y = 1')), 'x + y = 3, x - y = 1');
  });
});

describe('validateExpr limits', () => {
  it('rejects too many nodes', () => {
    const big: MathJSON = ['Add', ...Array.from({ length: 16 }, () => ['Add', ...Array.from({ length: 16 }, (_, i) => i)] as MathJSON)];
    assert.equal(validateExpr(big)?.code, 'IR_INVALID');
  });
  it('rejects deep trees', () => {
    let e: MathJSON = 'x';
    for (let i = 0; i < 25; i++) e = ['Negate', e];
    assert.notEqual(validateExpr(e), null);
    let ok: MathJSON = 'x';
    for (let i = 0; i < 23; i++) ok = ['Negate', ok];
    assert.equal(validateExpr(ok), null);
  });
  it('rejects floats, huge integers and Infinity outside bounds', () => {
    assert.notEqual(validateExpr(['Add', 'x', 0.5]), null);
    assert.notEqual(validateExpr(['Add', 'x', 1e13]), null);
    assert.notEqual(validateExpr(['Add', 'x', 'Infinity']), null);
    assert.equal(validateExpr(['Sum', 'x', ['Tuple', 'n', 1, 'Infinity']]), null);
  });
  it('rejects null outside an empty RHS', () => {
    assert.notEqual(validateExpr(null), null);
    assert.notEqual(validateExpr(['Equal', null, 1]), null);
    assert.equal(validateExpr(['Equal', 'x', null]), null);
  });
});

describe('hashing', () => {
  it('is key-order independent and deterministic', () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
    assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
    assert.match(hashOf({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
  });
});

describe('unparsed math', () => {
  const pmatrix = String.raw`\begin{pmatrix} 1 \ 2 \end{pmatrix}`;

  it('fails by default, so suggestions stay strict', () => {
    const r = wireToSegments([{ type: 'math', content: pmatrix }]);
    assert.equal(r.ok, false);
  });

  it('keeps the LaTeX as written when allowed', () => {
    const r = wireToSegments([{ type: 'text', content: 'so' }, { type: 'math', content: pmatrix }, { type: 'math', content: 'x + 1' }], { allowUnparsed: true });
    assert.ok(r.ok);
    assert.deepEqual(r.segments[1], { type: 'math', expr: ['Unparsed', pmatrix], notation: 'plain', latex: pmatrix });
    assert.deepEqual(r.segments[2]!.type === 'math' && r.segments[2]!.expr, ['Add', 'x', 1]);
    assert.ok(hasUnparsed(r.segments));
  });

  it('is valid IR, prints its source and has no free symbols', () => {
    const e: MathJSON = ['Equal', 'y', ['Unparsed', pmatrix]];
    assert.equal(validateExpr(e), null);
    assert.equal(printLatex(e), `y = {${pmatrix}}`);
    assert.deepEqual([...freeSymbols(e)], ['y']);
    assert.notEqual(validateExpr(['Unparsed', 3]), null);
  });
});
