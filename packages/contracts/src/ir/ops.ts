/**
 * Operator table for the mathematical IR (spec §6, plus v2.1 extensions:
 * PartialD, multi-argument / implicit-argument Apply, ordered Prime, unary PlusMinus).
 */

export type MathJSON = string | number | null | [string, ...MathJSON[]];

/** [minArgs, maxArgs] for each operator head. */
export const OPS: Record<string, readonly [number, number]> = {
  Add: [2, 16],
  Multiply: [2, 16],
  Subtract: [2, 2],
  Divide: [2, 2],
  Negate: [1, 1],
  Sqrt: [1, 1],
  Abs: [1, 1],
  Sin: [1, 1],
  Cos: [1, 1],
  Tan: [1, 1],
  Exp: [1, 1],
  Ln: [1, 1],
  Power: [2, 2],
  Equal: [2, 2],
  EqualChain: [3, 8],
  Less: [2, 2],
  LessEqual: [2, 2],
  Greater: [2, 2],
  GreaterEqual: [2, 2],
  NotEqual: [2, 2],
  And: [2, 16],
  Or: [2, 16],
  PlusMinus: [1, 2],
  Set: [0, 16],
  D: [2, 2],
  PartialD: [2, 2],
  // [Prime, [Apply, f, ...args], order]
  Prime: [2, 2],
  // [Apply, name, ...args]; zero args means "the declared arguments" (written as a bare ψ)
  Apply: [1, 5],
  Integrate: [2, 2],
  Evaluate: [2, 2],
  Sum: [2, 2],
  Limit: [2, 2],
  Unreadable: [0, 0],
  // [Unparsed, latex]: recognised LaTeX outside the parser's grammar; shown as written, never checked
  Unparsed: [1, 1],
  // positional only
  Tuple: [3, 3],
  LimitSpec: [4, 4],
};

export const RELATIONS = new Set(['Equal', 'EqualChain', 'Less', 'LessEqual', 'Greater', 'GreaterEqual', 'NotEqual']);
export const LOGIC = new Set(['And', 'Or']);
export const POSITIONAL = new Set(['Tuple', 'LimitSpec']);

export function isNode(e: MathJSON): e is [string, ...MathJSON[]] {
  return Array.isArray(e);
}

export function head(e: MathJSON): string | null {
  return Array.isArray(e) ? e[0] : null;
}

export function isRelation(e: MathJSON): boolean {
  const h = head(e);
  return h !== null && (RELATIONS.has(h) || LOGIC.has(h));
}
