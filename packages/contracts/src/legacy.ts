/**
 * Snapshots written before v2.2 carry a problem card. Opening one turns the card into given lines
 * at the top of the page, laid out like the templates: the statement, each condition and
 * definition (definitions stay definitions) on its own line, then the functions on one line and
 * the assumptions on one more, so nothing a checked line relied on is lost. The new lines have no proof yet: the notebook checks them when it opens.
 */
import type { MathJSON } from './ir/ops';
import { printLatex } from './ir/print';

interface LegacyAssumption {
  symbol: string;
  kind: string;
  lower?: MathJSON;
  upper?: MathJSON;
  expr?: MathJSON;
}

interface LegacyProblem {
  statement?: unknown[];
  definitions?: MathJSON[];
  conditions?: MathJSON[];
  assumptions?: LegacyAssumption[];
  functions?: { name: string; args: string[] }[];
}

function assumptionExpr(a: LegacyAssumption): MathJSON | null {
  switch (a.kind) {
    case 'positive':
      return ['Greater', a.symbol, 0];
    case 'nonnegative':
      return ['GreaterEqual', a.symbol, 0];
    case 'nonzero':
      return ['NotEqual', a.expr ?? a.symbol, 0];
    case 'positive_integer':
      return ['Element', a.symbol, 'PositiveIntegers'];
    case 'real':
      return ['Element', a.symbol, 'Reals'];
    case 'interval': {
      const parts: MathJSON[] = [];
      if (a.lower != null) parts.push(['LessEqual', a.lower, a.symbol]);
      if (a.upper != null) parts.push(['LessEqual', a.symbol, a.upper]);
      return parts.length > 1 ? ['And', ...parts] : (parts[0] ?? null);
    }
    default:
      return null;
  }
}

/** A line holds at most this many formulas (as the recognizer's wire format does). */
const PER_LINE = 8;

/**
 * Rewrites a pre-v2.2 snapshot (one with a `problem`) into the current shape. Anything else,
 * including a notebook converted earlier, passes through unchanged, so nothing converts twice.
 */
export function migrateNotebook(raw: unknown, version: string): unknown {
  if (!raw || typeof raw !== 'object' || !('problem' in raw)) return raw;
  const { problem, ...rest } = raw as { problem?: LegacyProblem; lines?: unknown };
  const p: LegacyProblem = problem ?? {};
  const lines = Array.isArray(rest.lines) ? (rest.lines as { id?: unknown }[]) : [];
  const taken = new Set(lines.map((l) => l?.id));
  const given: object[] = [];
  const line = (role: 'premise' | 'definition', segments: unknown[]) => {
    let n = given.length + 1;
    while (taken.has(`given-${n}`)) n += 1;
    taken.add(`given-${n}`);
    given.push({ id: `given-${n}`, version: 1, source: 'user', role, state: 'SETTLED', ink: [], segments });
  };
  const math = (expr: MathJSON) => ({ type: 'math', expr, notation: 'plain', latex: printLatex(expr) });
  // functions share a line, and so do the assumptions, as in the templates
  const compact = (exprs: MathJSON[]) => {
    for (let i = 0; i < exprs.length; i += PER_LINE) line('premise', exprs.slice(i, i + PER_LINE).map(math));
  };
  if (Array.isArray(p.statement) && p.statement.length) line('premise', p.statement);
  for (const c of p.conditions ?? []) line('premise', [math(c)]);
  for (const d of p.definitions ?? []) line('definition', [math(d)]);
  compact((p.functions ?? []).filter((f) => f.args.length).map((f): MathJSON => ['Apply', f.name, ...f.args]));
  compact((p.assumptions ?? []).map(assumptionExpr).filter((e): e is MathJSON => e !== null));
  return { ...rest, schema_version: version, lines: [...given, ...lines] };
}
