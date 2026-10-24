import { OPS, POSITIONAL, type MathJSON } from './ops';
import { SYMBOL_NAME, isConstant } from './symbols';

export const IR_LIMITS = {
  maxNodes: 256,
  maxDepth: 24,
  maxInteger: 1e12,
  maxExponent: 100,
} as const;

export interface IrIssue {
  code: 'IR_INVALID';
  message: string;
  path: string;
}

type Pos = 'math' | 'bound' | 'rhs';

/** Returns null when the expression is a valid IR tree, otherwise the first issue found. */
export function validateExpr(root: MathJSON): IrIssue | null {
  let nodes = 0;
  const fail = (message: string, path: string): IrIssue => ({ code: 'IR_INVALID', message, path });

  const isSymbol = (s: unknown): s is string =>
    typeof s === 'string' && SYMBOL_NAME.test(s) && !isConstant(s) && !(s in OPS);

  const walk = (e: MathJSON, depth: number, path: string, pos: Pos): IrIssue | null => {
    nodes += 1;
    if (nodes > IR_LIMITS.maxNodes) return fail(`more than ${IR_LIMITS.maxNodes} nodes`, path);
    if (depth > IR_LIMITS.maxDepth) return fail(`deeper than ${IR_LIMITS.maxDepth}`, path);

    if (e === null) {
      return pos === 'rhs' || pos === 'bound' ? null : fail('null outside an empty RHS or open bound', path);
    }
    if (typeof e === 'number') {
      if (!Number.isInteger(e)) return fail('non-integer number (decimals must be Divide)', path);
      if (Math.abs(e) > IR_LIMITS.maxInteger) return fail('integer magnitude above 10^12', path);
      return null;
    }
    if (typeof e === 'string') {
      if (isConstant(e)) {
        return e === 'Infinity' && pos !== 'bound' ? fail('Infinity outside a bound or limit value', path) : null;
      }
      return isSymbol(e) ? null : fail(`invalid symbol name "${e}"`, path);
    }
    if (!Array.isArray(e) || e.length === 0 || typeof e[0] !== 'string') return fail('malformed node', path);

    const [h, ...args] = e;
    const arity = OPS[h];
    if (!arity) return fail(`unknown operator "${h}"`, path);
    if (POSITIONAL.has(h)) return fail(`${h} outside its designated position`, path);
    if (args.length < arity[0] || args.length > arity[1]) return fail(`${h} takes ${arity[0]}–${arity[1]} arguments`, path);

    const sub = (i: number, p: Pos = 'math') => walk(args[i] as MathJSON, depth + 1, `${path}/${i + 1}`, p);

    switch (h) {
      case 'Apply': {
        if (!isSymbol(args[0])) return fail('Apply needs a function name', path);
        for (let i = 1; i < args.length; i++) { const r = sub(i); if (r) return r; }
        return null;
      }
      case 'Prime': {
        const inner = args[0];
        if (!Array.isArray(inner) || inner[0] !== 'Apply') return fail('Prime wraps an Apply node', path);
        const order = args[1];
        if (typeof order !== 'number' || !Number.isInteger(order) || order < 1 || order > 3) return fail('Prime order must be 1–3', path);
        return sub(0);
      }
      case 'D':
      case 'PartialD': {
        if (!isSymbol(args[1])) return fail(`${h} needs a variable symbol`, path);
        return sub(0);
      }
      case 'Integrate':
      case 'Evaluate':
      case 'Sum': {
        const t = args[1];
        if (!Array.isArray(t) || t[0] !== 'Tuple' || t.length !== 4) return fail(`${h} needs [Tuple, var, lower, upper]`, path);
        if (!isSymbol(t[1])) return fail('Tuple variable must be a symbol', path);
        const r = sub(0);
        if (r) return r;
        for (const i of [2, 3]) {
          const b = walk(t[i] as MathJSON, depth + 2, `${path}/2/${i}`, 'bound');
          if (b) return b;
        }
        return null;
      }
      case 'Limit': {
        const s = args[1];
        if (!Array.isArray(s) || s[0] !== 'LimitSpec' || s.length !== 4) return fail('Limit needs [LimitSpec, var, value, dir]', path);
        if (!isSymbol(s[1])) return fail('LimitSpec variable must be a symbol', path);
        if (s[3] !== 'both' && s[3] !== 'left' && s[3] !== 'right') return fail('LimitSpec direction', path);
        const r = sub(0);
        if (r) return r;
        return walk(s[2] as MathJSON, depth + 2, `${path}/2/2`, 'bound');
      }
      case 'Power': {
        const ex = args[1];
        if (typeof ex === 'number' && Math.abs(ex) > IR_LIMITS.maxExponent) return fail('exponent magnitude above 100', path);
        return sub(0) ?? sub(1);
      }
      case 'Equal': {
        if (args[0] === null) return fail('empty LHS', path);
        return sub(0) ?? sub(1, 'rhs');
      }
      default: {
        for (let i = 0; i < args.length; i++) { const r = sub(i); if (r) return r; }
        return null;
      }
    }
  };

  if (root === null) return fail('null root', '');
  return walk(root, 1, '', 'math');
}

/** Free symbols, excluding variables bound by Integrate/Evaluate/Sum/Limit. */
export function freeSymbols(e: MathJSON, bound: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const walk = (x: MathJSON, b: ReadonlySet<string>) => {
    if (typeof x === 'string') {
      if (!isConstant(x) && !b.has(x)) out.add(x);
      return;
    }
    if (!Array.isArray(x)) return;
    const [h, ...args] = x;
    if (h === 'Integrate' || h === 'Evaluate' || h === 'Sum') {
      const t = args[1] as MathJSON[];
      const v = t[1] as string;
      walk(args[0] as MathJSON, new Set([...b, v]));
      walk(t[2] as MathJSON, b);
      walk(t[3] as MathJSON, b);
      return;
    }
    if (h === 'Limit') {
      const s = args[1] as MathJSON[];
      walk(args[0] as MathJSON, new Set([...b, s[1] as string]));
      walk(s[2] as MathJSON, b);
      return;
    }
    if (h === 'Apply') {
      for (const a of args.slice(1)) walk(a as MathJSON, b);
      return;
    }
    if (h === 'Prime') { walk(args[0] as MathJSON, b); return; }
    for (const a of args) walk(a as MathJSON, b);
  };
  walk(e, bound);
  return out;
}
