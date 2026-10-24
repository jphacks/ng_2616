/**
 * Snapshots written before v2.2 carry a problem card. Opening one turns the card into given lines
 * at the top of the page (definitions stay definitions), in the card's order, so nothing a checked
 * line relied on is lost. The new lines have no proof yet: the notebook checks them when it opens.
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
  origin?: { kind?: string; name?: string; page?: number; question_label?: string; transcription?: string; corrected?: boolean; mock?: boolean };
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

/** Rewrites a pre-v2.2 snapshot (one with a `problem`) into the current shape; anything else passes through. */
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
    const origin = p.origin;
    const pdf = origin?.kind === 'pdf' && typeof origin.name === 'string';
    given.push({ id: `given-${n}`, version: 1, source: pdf ? 'pdf' : 'user', role, state: 'SETTLED', ink: [], segments,
      ...(pdf ? { document_origin: { name: origin.name, page: origin.page ?? 1, has_unreadable: false }, extensions: { pdf_question: { label: origin.question_label, transcription: origin.transcription, corrected: origin.corrected, mock: origin.mock } } } : {}) });
  };
  const math = (expr: MathJSON) => [{ type: 'math', expr, notation: 'plain', latex: printLatex(expr) }];
  if (Array.isArray(p.statement) && p.statement.length) line('premise', p.statement);
  for (const c of p.conditions ?? []) line('premise', math(c));
  for (const d of p.definitions ?? []) line('definition', math(d));
  for (const a of p.assumptions ?? []) {
    const e = assumptionExpr(a);
    if (e !== null) line('premise', math(e));
  }
  for (const f of p.functions ?? []) if (f.args.length) line('premise', math(['Apply', f.name, ...f.args]));
  return { ...rest, schema_version: version, lines: [...given, ...lines] };
}
