import test from 'node:test';
import assert from 'node:assert/strict';
import type { Line, MathJSON } from '@mn/contracts';
import { analyzeLineForPlot, evaluateExpr, generatePlotData } from '../../src/features/plot/evaluator';

function makeMathLine(latex: string, expr: MathJSON): Line {
  return {
    id: 'test-line-1',
    role: 'step',
    source: 'user',
    state: 'SETTLED',
    ink: [],
    segments: [
      {
        type: 'math',
        latex,
        expr,
        notation: 'plain',
      },
    ],
    version: 1,
  };
}

test('analyzeLineForPlot: quadratic equation y = x^2 - 4x + 3', () => {
  const expr: MathJSON = [
    'Equal',
    'y',
    ['Add', ['Power', 'x', 2], ['Negate', ['Multiply', 4, 'x']], 3],
  ];
  const line = makeMathLine('y = x^2 - 4x + 3', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, true);
  assert.equal(analysis.xVar, 'x');
  assert.deepEqual(analysis.freeSymbols, ['x']);
  assert.equal(Object.keys(analysis.paramsMeta).length, 0);

  // Evaluate roots
  assert.equal(evaluateExpr(analysis.targetExpr!, { x: 1 }), 0);
  assert.equal(evaluateExpr(analysis.targetExpr!, { x: 3 }), 0);
  assert.equal(evaluateExpr(analysis.targetExpr!, { x: 2 }), -1);
});

test('analyzeLineForPlot: function with parameters y = a*x^2 + b', () => {
  const expr: MathJSON = [
    'Equal',
    'y',
    ['Add', ['Multiply', 'a', ['Power', 'x', 2]], 'b'],
  ];
  const line = makeMathLine('y = ax^2 + b', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, true);
  assert.equal(analysis.xVar, 'x');
  assert.ok(analysis.freeSymbols.includes('a'));
  assert.ok(analysis.freeSymbols.includes('b'));
  assert.ok('a' in analysis.paramsMeta);
  assert.ok('b' in analysis.paramsMeta);

  // Evaluate with custom params: a=2, b=-8 -> 2*2^2 - 8 = 0
  assert.equal(evaluateExpr(analysis.targetExpr!, { x: 2, a: 2, b: -8 }), 0);
});

test('analyzeLineForPlot: function notation f(x) = sin(x)', () => {
  const expr: MathJSON = ['Equal', ['Apply', 'f', 'x'], ['Sin', 'x']];
  const line = makeMathLine('f(x) = \\sin(x)', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, true);
  assert.equal(analysis.xVar, 'x');

  const val0 = evaluateExpr(analysis.targetExpr!, { x: 0 });
  const valPi2 = evaluateExpr(analysis.targetExpr!, { x: Math.PI / 2 });

  assert.equal(val0, 0);
  assert.ok(Math.abs(valPi2 - 1) < 1e-9);
});

test('analyzeLineForPlot: vertical line x = 3 is rejected', () => {
  const expr: MathJSON = ['Equal', 'x', 3];
  const line = makeMathLine('x = 3', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, false);
  assert.equal(analysis.reasonKey, 'plot.reason.verticalLine');
});

test('analyzeLineForPlot: implicit equation x^2 + y^2 = 1 is rejected', () => {
  const expr: MathJSON = [
    'Equal',
    ['Add', ['Power', 'x', 2], ['Power', 'y', 2]],
    1,
  ];
  const line = makeMathLine('x^2 + y^2 = 1', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, false);
  assert.equal(analysis.reasonKey, 'plot.reason.implicit');
});

test('analyzeLineForPlot: inequality x < 2 is rejected', () => {
  const expr: MathJSON = ['Less', 'x', 2];
  const line = makeMathLine('x < 2', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, false);
  assert.equal(analysis.reasonKey, 'plot.reason.inequation');
});

test('analyzeLineForPlot: large scale linear equation y = 100x', () => {
  const expr: MathJSON = ['Equal', 'y', ['Multiply', 100, 'x']];
  const line = makeMathLine('y = 100x', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, true);
  assert.equal(analysis.xVar, 'x');
  assert.equal(evaluateExpr(analysis.targetExpr!, { x: 5 }), 500);
});

test('analyzeLineForPlot: multivariable expression x^2 + y^2 without equal is rejected', () => {
  const expr: MathJSON = ['Add', ['Power', 'x', 2], ['Power', 'y', 2]];
  const line = makeMathLine('x^2 + y^2', expr);
  const analysis = analyzeLineForPlot(line);

  assert.equal(analysis.drawable, false);
  assert.equal(analysis.reasonKey, 'plot.reason.multiVar');
});

test('analyzeLineForPlot: forbidden operations (Integrate, D) are marked undrawable', () => {
  const intExpr: MathJSON = ['Integrate', ['Multiply', 2, 'x'], 'x'];
  const lineInt = makeMathLine('\\int 2x dx', intExpr);
  const analysisInt = analyzeLineForPlot(lineInt);

  assert.equal(analysisInt.drawable, false);
  assert.equal(analysisInt.reasonKey, 'plot.reason.forbidden');
  assert.ok(analysisInt.reason?.includes('積分'));

  const diffExpr: MathJSON = ['D', ['Power', 'x', 2], 'x'];
  const lineDiff = makeMathLine('\\frac{d}{dx} x^2', diffExpr);
  const analysisDiff = analyzeLineForPlot(lineDiff);

  assert.equal(analysisDiff.drawable, false);
  assert.equal(analysisDiff.reasonKey, 'plot.reason.forbidden');
});

test('generatePlotData: handles division by zero and asymptotes with null cuts', () => {
  const expr: MathJSON = ['Divide', 1, 'x'];
  const data = generatePlotData(expr, 'x', {}, [-2, 2], 5);

  // sample points: -2, -1, 0, 1, 2
  assert.equal(data.x.length, 5);
  assert.equal(data.y[0], -0.5);
  assert.equal(data.y[1], -1);
  assert.equal(data.y[2], null); // at x=0, 1/0 is clipped as null
  assert.equal(data.y[3], 1);
  assert.equal(data.y[4], 0.5);
});
