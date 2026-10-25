/**
 * IR → LaTeX printer. Output is rendered by KaTeX and, for any IR the parser produced,
 * parses back to the identical IR (round-trip tested). It never simplifies.
 */
import type { MathJSON } from './ops';
import { NUMBER_SETS, constantToLatex, isConstant, symbolToLatex, type NumberSet } from './symbols';

const REL = 1;
const ADD = 2;
const MUL = 3;
const FACTOR = 3.5; // context for a factor inside Multiply
const POW = 5;
const ATOM = 6;

type Out = [string, number];

const wrap = (s: string) => `\\left(${s}\\right)`;

function p(e: MathJSON, ctx: number): string {
  const [s, prec] = render(e);
  return prec < ctx ? wrap(s) : s;
}

function fnArg(e: MathJSON): string {
  return wrap(p(e, 0));
}

function bounds(lo: MathJSON, hi: MathJSON): string {
  return `${lo === null ? '' : `_{${p(lo, 0)}}`}${hi === null ? '' : `^{${p(hi, 0)}}`}`;
}

const isImplicitApply = (e: MathJSON) => Array.isArray(e) && e[0] === 'Apply' && e.length === 2;

const CHAIN_OPS: Record<string, string> = { Equal: '=', Less: '<', LessEqual: '\\le', Greater: '>', GreaterEqual: '\\ge', NotEqual: '\\ne' };

/** Relations where each right-hand side is the next left-hand side: a chain such as a = b < c. */
function isChain(rels: MathJSON[]): boolean {
  const ok = (r: MathJSON): boolean => Array.isArray(r) && r.length === 3 && (r[0] as string) in CHAIN_OPS && r[2] !== null;
  return rels.length >= 2 && rels.every(ok) && rels.slice(1).every((r, i) => JSON.stringify((r as MathJSON[])[1]) === JSON.stringify((rels[i] as MathJSON[])[2]));
}

function renderDerivative(e: [string, ...MathJSON[]]): Out {
  const kind = e[0];
  const mark = kind === 'D' ? 'd' : '\\partial';
  const vars: string[] = [];
  let x: MathJSON = e;
  while (Array.isArray(x) && x[0] === kind) {
    vars.push(x[2] as string);
    x = x[1] as MathJSON;
  }
  const runs: [string, number][] = [];
  for (const v of vars) {
    const last = runs[runs.length - 1];
    if (last && last[0] === v) last[1]++;
    else runs.push([v, 1]);
  }
  const den = runs.map(([v, n]) => `${mark} ${symbolToLatex(v)}${n > 1 ? `^{${n}}` : ''}`).join(' ');
  const top = vars.length > 1 ? `${mark}^{${vars.length}}` : mark;
  if (isImplicitApply(x)) {
    return [`\\frac{${top} ${symbolToLatex((x as MathJSON[])[1] as string)}}{${den}}`, ATOM];
  }
  return [`\\frac{${top}}{${den}} ${p(x, ATOM)}`, MUL];
}

function render(e: MathJSON): Out {
  if (e === null) return ['', ATOM];
  if (typeof e === 'number') return e < 0 ? [`-${-e}`, ADD] : [String(e), ATOM];
  if (typeof e === 'string') return [isConstant(e) ? constantToLatex(e) : symbolToLatex(e), ATOM];
  const [h, ...a] = e;
  const a0 = a[0] as MathJSON;
  const a1 = a[1] as MathJSON;
  switch (h) {
    case 'Add': {
      const first = Array.isArray(a0) && a0[0] === 'Negate' ? `-${p(a0[1] as MathJSON, MUL)}` : p(a0, MUL);
      let s = first;
      for (const x of a.slice(1)) {
        s += Array.isArray(x) && x[0] === 'Negate' ? ` - ${p(x[1] as MathJSON, MUL)}` : ` + ${p(x, MUL)}`;
      }
      return [s, ADD];
    }
    case 'Subtract':
      return [`${p(a0, MUL)} - ${p(a1, MUL)}`, ADD];
    case 'Negate':
      return [`-${p(a0, MUL)}`, ADD];
    case 'PlusMinus':
      return a.length === 1 ? [`\\pm ${p(a0, MUL)}`, ADD] : [`${p(a0, MUL)} \\pm ${p(a1, MUL)}`, ADD];
    case 'Multiply': {
      let s = '';
      let prev: MathJSON | undefined;
      for (const f of a) {
        const fs = p(f, FACTOR);
        if (prev === undefined) s = fs;
        else {
          const dot = /^[0-9]/.test(fs) || (fs.startsWith('\\left(') && (typeof prev === 'string' || isImplicitApply(prev)));
          s += dot ? ` \\cdot ${fs}` : ` ${fs}`;
        }
        prev = f;
      }
      return [s, MUL];
    }
    case 'Divide':
      return [`\\frac{${p(a0, 0)}}{${p(a1, 0)}}`, ATOM];
    case 'Power': {
      if (Array.isArray(a0) && ['Sin', 'Cos', 'Tan', 'Ln'].includes(a0[0])) {
        const fn = { Sin: 'sin', Cos: 'cos', Tan: 'tan', Ln: 'ln' }[a0[0] as 'Sin']!;
        return [`\\${fn}^{${p(a1, 0)}}${fnArg(a0[1] as MathJSON)}`, ATOM];
      }
      const base = Array.isArray(a0) && a0[0] === 'Divide' ? wrap(p(a0, 0)) : p(a0, ATOM);
      return [`${base}^{${p(a1, 0)}}`, POW];
    }
    case 'Exp':
      return [`e^{${p(a0, 0)}}`, POW];
    case 'Sqrt':
      return [`\\sqrt{${p(a0, 0)}}`, ATOM];
    case 'Abs':
      return [`\\left|${p(a0, 0)}\\right|`, ATOM];
    case 'Sin': return [`\\sin${fnArg(a0)}`, ATOM];
    case 'Cos': return [`\\cos${fnArg(a0)}`, ATOM];
    case 'Tan': return [`\\tan${fnArg(a0)}`, ATOM];
    case 'Ln': return [`\\ln${fnArg(a0)}`, ATOM];
    case 'Apply': {
      const args = a.slice(1);
      const name = symbolToLatex(a0 as string);
      return [args.length ? `${name}${wrap(args.map((x) => p(x, 0)).join(', '))}` : name, ATOM];
    }
    case 'Prime': {
      const inner = a0 as MathJSON[];
      const args = inner.slice(2);
      const s = `${symbolToLatex(inner[1] as string)}${"'".repeat(a1 as number)}`;
      return [args.length ? `${s}${wrap(args.map((x) => p(x, 0)).join(', '))}` : s, ATOM];
    }
    case 'D':
    case 'PartialD':
      return renderDerivative(e);
    case 'Integrate': {
      const t = a1 as MathJSON[];
      return [`\\int${bounds(t[2] as MathJSON, t[3] as MathJSON)} ${p(a0, ADD)} \\, d ${symbolToLatex(t[1] as string)}`, MUL];
    }
    case 'Evaluate': {
      const t = a1 as MathJSON[];
      return [`\\left[${p(a0, 0)}\\right]${bounds(t[2] as MathJSON, t[3] as MathJSON)}`, ATOM];
    }
    case 'Sum': {
      const t = a1 as MathJSON[];
      const lo = t[2] as MathJSON;
      const hi = t[3] as MathJSON;
      const sub = `${symbolToLatex(t[1] as string)}${lo === null ? '' : ` = ${p(lo, 0)}`}`;
      return [`\\sum_{${sub}}${hi === null ? '' : `^{${p(hi, 0)}}`} ${p(a0, MUL)}`, ADD];
    }
    case 'Limit': {
      const s = a1 as MathJSON[];
      const dir = s[3] === 'right' ? '^{+}' : s[3] === 'left' ? '^{-}' : '';
      return [`\\lim_{${symbolToLatex(s[1] as string)} \\to ${p(s[2] as MathJSON, 0)}${dir}} ${p(a0, MUL)}`, ADD];
    }
    case 'Equal':
      return [a1 === null ? `${p(a0, ADD)} =` : `${p(a0, ADD)} = ${p(a1, ADD)}`, REL];
    case 'EqualChain':
      return [a.map((x) => p(x, ADD)).join(' = '), REL];
    case 'Less': return [`${p(a0, ADD)} < ${p(a1, ADD)}`, REL];
    case 'LessEqual': return [`${p(a0, ADD)} \\le ${p(a1, ADD)}`, REL];
    case 'Greater': return [`${p(a0, ADD)} > ${p(a1, ADD)}`, REL];
    case 'GreaterEqual': return [`${p(a0, ADD)} \\ge ${p(a1, ADD)}`, REL];
    case 'NotEqual': return [`${p(a0, ADD)} \\ne ${p(a1, ADD)}`, REL];
    case 'Element': return [`${p(a0, ADD)} \\in ${NUMBER_SETS[a1 as NumberSet]}`, REL];
    case 'And': {
      // "a = b < c = d" parses to And(a = b, b < c, c = d): print it back as the chain it was written as
      if (isChain(a)) return [p((a[0] as MathJSON[])[1]!, ADD) + a.map((x) => ` ${CHAIN_OPS[(x as MathJSON[])[0] as string]} ${p((x as MathJSON[])[2]!, ADD)}`).join(''), REL];
      return [a.map((x) => p(x, REL)).join(', '), 0];
    }
    case 'Or':
      return [a.map((x) => p(x, REL)).join(' \\lor '), 0];
    case 'Set':
      return [`\\left\\{${a.map((x) => p(x, ADD)).join(', ')}\\right\\}`, ATOM];
    case 'Unreadable':
      return ['\\square', ATOM];
    case 'Unparsed':
      return [`{${a0 as string}}`, ATOM];
    default:
      return [`\\mathrm{${h}}`, ATOM];
  }
}

export function printLatex(e: MathJSON): string {
  return render(e)[0];
}

export function printSegmentLatex(expr: MathJSON, notation: 'plain' | 'continuation'): string {
  return notation === 'continuation' ? `= ${printLatex(expr)}` : printLatex(expr);
}
