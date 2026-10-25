/**
 * v2.2: functions are declared by lines. A math segment that is only a name applied to distinct
 * variables, such as "\Psi(x,t)", declares that function for the whole notebook, so a bare Ψ in
 * "\frac{\partial \Psi}{\partial t}" reads as Ψ(x,t) even on a line written above the declaration.
 */
import type { MathJSON } from './ir/ops';
import { parseMathLatex, type FunctionDecl } from './ir/parse';
import { printSegmentLatex } from './ir/print';
import type { Line, Segment } from './schemas';

/** The most declared functions a request carries (RecognizeInput.functions). */
export const MAX_FUNCTIONS = 16;

export function functionDeclarationOf(expr: MathJSON): FunctionDecl | null {
  if (!Array.isArray(expr) || expr[0] !== 'Apply' || expr.length < 3) return null;
  const [, name, ...args] = expr;
  if (typeof name !== 'string' || !args.every((a): a is string => typeof a === 'string')) return null;
  return new Set(args).size === args.length ? { name, args } : null;
}

/** Functions declared anywhere in the notebook, first declaration of a name wins. */
export function declaredFunctions(lines: readonly Pick<Line, 'state' | 'segments'>[]): FunctionDecl[] {
  const out = new Map<string, FunctionDecl>();
  for (const l of lines) {
    if (l.state === 'SUPERSEDED') continue;
    for (const s of l.segments) {
      if (s.type !== 'math' || s.notation !== 'plain') continue;
      const d = functionDeclarationOf(s.expr);
      if (d && !out.has(d.name)) out.set(d.name, d);
    }
  }
  return [...out.values()].slice(0, MAX_FUNCTIONS);
}

export const sameFunctions = (a: readonly FunctionDecl[], b: readonly FunctionDecl[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Parses a line's formulas again with the given declarations (from the LaTeX as read when the line
 * has it). Returns the same array when nothing changes, so callers can skip untouched lines.
 */
export function reparseSegments(segments: Line['segments'], functions: readonly FunctionDecl[]): Line['segments'] {
  let changed = false;
  const out = segments.map((s: Segment): Segment => {
    if (s.type !== 'math' || (Array.isArray(s.expr) && s.expr[0] === 'Unparsed')) return s;
    const r = parseMathLatex(s.source_latex ?? s.latex, { functions });
    if (!r.ok || JSON.stringify(r.expr) === JSON.stringify(s.expr)) return s;
    changed = true;
    return { ...s, expr: r.expr, notation: r.notation, latex: printSegmentLatex(r.expr, r.notation) };
  });
  return changed ? out : segments;
}
