import type { Line, MathJSON } from '@mn/contracts';
import type { ParamMeta, PlotAnalysis } from './types';

const CONSTANTS = new Set(['Pi', 'ExponentialE', 'ImaginaryUnit', 'Infinity', 'e', 'i', 'True', 'False']);
const FORBIDDEN_HEADS = new Set(['Integrate', 'D', 'PartialD', 'Prime', 'Sum', 'Limit', 'Unparsed', 'Unreadable']);
const INEQUALITY_HEADS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'NotEqual',
  'EqualChain',
  'Element',
  'NotElement',
  'Subset',
  'SubsetEqual',
  'Superset',
  'SupersetEqual',
  'And',
  'Or',
  'Not',
]);

function collectSymbols(expr: MathJSON, out: Set<string>): void {
  if (typeof expr === 'string') {
    if (!CONSTANTS.has(expr) && !/^[0-9]/.test(expr)) {
      out.add(expr);
    }
    return;
  }
  if (Array.isArray(expr)) {
    const [head, ...args] = expr;
    if (typeof head === 'string' && head === 'Apply') {
      for (let i = 1; i < args.length; i++) {
        collectSymbols(args[i], out);
      }
      return;
    }
    for (const arg of args) {
      collectSymbols(arg, out);
    }
  }
}

function hasForbidden(expr: MathJSON): boolean {
  if (!Array.isArray(expr)) return false;
  const [head, ...args] = expr;
  if (typeof head === 'string' && FORBIDDEN_HEADS.has(head)) return true;
  return args.some(hasForbidden);
}

function hasRelation(expr: MathJSON): boolean {
  if (!Array.isArray(expr)) return false;
  const [head, ...args] = expr;
  if (typeof head === 'string' && (INEQUALITY_HEADS.has(head) || head === 'Equal')) return true;
  return args.some(hasRelation);
}

export function analyzeLineForPlot(line: Line): PlotAnalysis {
  const mathSeg = line.segments.find((s) => s.type === 'math');
  if (!mathSeg || !mathSeg.expr) {
    return {
      drawable: false,
      reasonKey: 'plot.reason.noExpr',
      reason: '数式がありません',
      xVar: 'x',
      latex: '',
      targetExpr: null,
      freeSymbols: [],
      paramsMeta: {},
      initialParams: {},
    };
  }

  const expr = mathSeg.expr;
  const latex = mathSeg.latex ?? '';

  if (hasForbidden(expr)) {
    return {
      drawable: false,
      reasonKey: 'plot.reason.forbidden',
      reason: '積分・微分・和を含む式は現在グラフ描画できません',
      xVar: 'x',
      latex,
      targetExpr: null,
      freeSymbols: [],
      paramsMeta: {},
      initialParams: {},
    };
  }

  // Reject inequalities and logic relations
  if (Array.isArray(expr) && INEQUALITY_HEADS.has(expr[0])) {
    return {
      drawable: false,
      reasonKey: 'plot.reason.inequation',
      reason: '不等式は現在グラフ描画できません',
      xVar: 'x',
      latex,
      targetExpr: null,
      freeSymbols: [],
      paramsMeta: {},
      initialParams: {},
    };
  }

  let targetExpr: MathJSON = null;
  let xVar = 'x';

  if (Array.isArray(expr) && expr[0] === 'Equal') {
    if (expr.length !== 3) {
      return {
        drawable: false,
        reasonKey: 'plot.reason.implicit',
        reason: '陰関数（円や楕円など）は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    }

    const lhs = expr[1];
    const rhs = expr[2];

    if (hasRelation(lhs) || hasRelation(rhs)) {
      return {
        drawable: false,
        reasonKey: 'plot.reason.implicit',
        reason: '陰関数（円や楕円など）は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    }

    const lhsSymbols = new Set<string>();
    collectSymbols(lhs, lhsSymbols);
    const rhsSymbols = new Set<string>();
    collectSymbols(rhs, rhsSymbols);

    // Form 1: Function application LHS, e.g. f(x) = ...
    if (Array.isArray(lhs) && lhs[0] === 'Apply' && typeof lhs[2] === 'string') {
      if (rhsSymbols.has('y')) {
        return {
          drawable: false,
          reasonKey: 'plot.reason.multiVar',
          reason: '未知数が複数ある式は現在グラフ描画できません',
          xVar: 'x',
          latex,
          targetExpr: null,
          freeSymbols: [],
          paramsMeta: {},
          initialParams: {},
        };
      }
      xVar = lhs[2];
      targetExpr = rhs;
    }
    // Form 2: Explicit dependent variable y on LHS, e.g. y = f(x)
    else if (typeof lhs === 'string' && (lhs === 'y' || lhs === 'f')) {
      if (rhsSymbols.has('y')) {
        return {
          drawable: false,
          reasonKey: 'plot.reason.implicit',
          reason: '陰関数（円や楕円など）は現在グラフ描画できません',
          xVar: 'x',
          latex,
          targetExpr: null,
          freeSymbols: [],
          paramsMeta: {},
          initialParams: {},
        };
      }
      targetExpr = rhs;
      if (rhsSymbols.has('x')) xVar = 'x';
      else if (rhsSymbols.has('t')) xVar = 't';
      else if (rhsSymbols.size === 1) xVar = Array.from(rhsSymbols)[0]!;
      else xVar = 'x';
    }
    // Form 3: Explicit dependent variable y on RHS, e.g. f(x) = y
    else if (typeof rhs === 'string' && (rhs === 'y' || rhs === 'f')) {
      if (lhsSymbols.has('y')) {
        return {
          drawable: false,
          reasonKey: 'plot.reason.implicit',
          reason: '陰関数（円や楕円など）は現在グラフ描画できません',
          xVar: 'x',
          latex,
          targetExpr: null,
          freeSymbols: [],
          paramsMeta: {},
          initialParams: {},
        };
      }
      targetExpr = lhs;
      if (lhsSymbols.has('x')) xVar = 'x';
      else if (lhsSymbols.has('t')) xVar = 't';
      else if (lhsSymbols.size === 1) xVar = Array.from(lhsSymbols)[0]!;
      else xVar = 'x';
    }
    // Form 4: Vertical lines, e.g. x = 3
    else if (lhs === 'x' && !rhsSymbols.has('x') && !rhsSymbols.has('y')) {
      return {
        drawable: false,
        reasonKey: 'plot.reason.verticalLine',
        reason: 'x = 定数 の縦線は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    } else if (rhs === 'x' && !lhsSymbols.has('x') && !lhsSymbols.has('y')) {
      return {
        drawable: false,
        reasonKey: 'plot.reason.verticalLine',
        reason: 'x = 定数 の縦線は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    }
    // Any other equation: implicit relation (e.g. x^2 + y^2 = 1)
    else {
      return {
        drawable: false,
        reasonKey: 'plot.reason.implicit',
        reason: '陰関数（円や楕円など）は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    }
  } else {
    // Single expression (e.g. x^2 - 4x + 3, sin(x), a*x^2 + b)
    if (hasRelation(expr)) {
      return {
        drawable: false,
        reasonKey: 'plot.reason.inequation',
        reason: '不等式は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    }

    const symbolsSet = new Set<string>();
    collectSymbols(expr, symbolsSet);

    // If expression contains 'y', it cannot be treated as y = f(x)
    if (symbolsSet.has('y')) {
      return {
        drawable: false,
        reasonKey: 'plot.reason.multiVar',
        reason: '未知数が複数ある式は現在グラフ描画できません',
        xVar: 'x',
        latex,
        targetExpr: null,
        freeSymbols: [],
        paramsMeta: {},
        initialParams: {},
      };
    }

    targetExpr = expr;
    if (symbolsSet.has('x')) xVar = 'x';
    else if (symbolsSet.has('t')) xVar = 't';
    else if (symbolsSet.size === 1) xVar = Array.from(symbolsSet)[0]!;
    else xVar = 'x';
  }

  const targetSymbols = new Set<string>();
  collectSymbols(targetExpr, targetSymbols);
  const freeSymbols = Array.from(targetSymbols);

  // Parameter sliders: all free symbols other than the independent variable (xVar).
  // 'y' is strictly prohibited from becoming a slider parameter.
  const paramNames = freeSymbols.filter((s) => s !== xVar && s !== 'y');
  const paramsMeta: Record<string, ParamMeta> = {};
  const initialParams: Record<string, number> = {};

  for (const p of paramNames) {
    paramsMeta[p] = {
      name: p,
      min: -10,
      max: 10,
      step: 0.1,
      defaultValue: 1,
    };
    initialParams[p] = 1;
  }

  return {
    drawable: true,
    xVar,
    latex,
    targetExpr,
    freeSymbols,
    paramsMeta,
    initialParams,
  };
}

export function evaluateExpr(
  expr: MathJSON,
  scope: Record<string, number>,
): number {
  if (expr === null || expr === undefined) return NaN;

  if (typeof expr === 'number') return expr;

  if (typeof expr === 'string') {
    if (expr === 'Pi') return Math.PI;
    if (expr === 'ExponentialE' || expr === 'e') return Math.E;
    if (expr in scope) return scope[expr]!;
    const parsed = Number(expr);
    return isNaN(parsed) ? NaN : parsed;
  }

  if (Array.isArray(expr)) {
    const [head, ...args] = expr;
    if (typeof head !== 'string') return NaN;

    switch (head) {
      case 'Add':
        return args.reduce<number>((sum, a) => sum + evaluateExpr(a, scope), 0);
      case 'Multiply':
        return args.reduce<number>((prod, a) => prod * evaluateExpr(a, scope), 1);
      case 'Subtract': {
        if (args.length === 1) return -evaluateExpr(args[0], scope);
        return evaluateExpr(args[0], scope) - evaluateExpr(args[1], scope);
      }
      case 'Divide': {
        const denom = evaluateExpr(args[1], scope);
        if (Math.abs(denom) < 1e-12) return NaN;
        return evaluateExpr(args[0], scope) / denom;
      }
      case 'Negate':
        return -evaluateExpr(args[0], scope);
      case 'Power': {
        const base = evaluateExpr(args[0], scope);
        const exp = evaluateExpr(args[1], scope);
        if (base < 0 && Math.floor(exp) !== exp) return NaN;
        return Math.pow(base, exp);
      }
      case 'Sqrt': {
        const val = evaluateExpr(args[0], scope);
        return val < 0 ? NaN : Math.sqrt(val);
      }
      case 'Abs':
        return Math.abs(evaluateExpr(args[0], scope));
      case 'Sin':
        return Math.sin(evaluateExpr(args[0], scope));
      case 'Cos':
        return Math.cos(evaluateExpr(args[0], scope));
      case 'Tan': {
        const val = evaluateExpr(args[0], scope);
        const cosVal = Math.cos(val);
        if (Math.abs(cosVal) < 1e-6) return NaN;
        return Math.tan(val);
      }
      case 'Exp':
        return Math.exp(evaluateExpr(args[0], scope));
      case 'Ln':
      case 'Log': {
        const val = evaluateExpr(args[0], scope);
        return val <= 0 ? NaN : Math.log(val);
      }
      case 'Apply': {
        const fnName = args[0];
        const argVal = evaluateExpr(args[1], scope);
        if (typeof fnName === 'string') {
          const lower = fnName.toLowerCase();
          if (lower === 'sin') return Math.sin(argVal);
          if (lower === 'cos') return Math.cos(argVal);
          if (lower === 'tan') return Math.abs(Math.cos(argVal)) < 1e-6 ? NaN : Math.tan(argVal);
          if (lower === 'exp') return Math.exp(argVal);
          if (lower === 'ln' || lower === 'log') return argVal <= 0 ? NaN : Math.log(argVal);
          if (lower === 'sqrt') return argVal < 0 ? NaN : Math.sqrt(argVal);
          if (lower === 'abs') return Math.abs(argVal);
        }
        return NaN;
      }
      default:
        return NaN;
    }
  }

  return NaN;
}

export function generatePlotData(
  targetExpr: MathJSON,
  xVar: string,
  params: Record<string, number>,
  range: [number, number],
  points = 400,
): { x: number[]; y: (number | null)[] } {
  const [min, max] = range;
  const step = (max - min) / (points - 1);
  const xArr: number[] = new Array(points);
  const yArr: (number | null)[] = new Array(points);

  const scope: Record<string, number> = { ...params };

  for (let i = 0; i < points; i++) {
    const xVal = min + i * step;
    scope[xVar] = xVal;
    const yVal = evaluateExpr(targetExpr, scope);

    xArr[i] = xVal;
    if (isNaN(yVal) || !isFinite(yVal) || Math.abs(yVal) > 1e6) {
      yArr[i] = null;
    } else {
      yArr[i] = yVal;
    }
  }

  return { x: xArr, y: yArr };
}
