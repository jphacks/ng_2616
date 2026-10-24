/** Turn LaTeX fixtures into IR payloads (shared by the emit script and frontend presets). */
import { parseMathLatex, type ParseOptions } from '../src/ir';
import { segmentsFromSource, toInputSegments } from '../src/segments';
import type { Assumption, MathJSON } from '../src';
import type { CasCase, FixtureProblem } from './cas-cases';

function ir(latex: string, opts: ParseOptions): MathJSON {
  const r = parseMathLatex(latex, opts);
  if (!r.ok) throw new Error(`fixture "${latex}": ${r.error.message}`);
  return r.expr;
}

export function buildProblem(p: FixtureProblem, id = 'P') {
  const opts: ParseOptions = { functions: p.functions ?? [] };
  const assumptions: Assumption[] = (p.assumptions ?? []).map((a) => {
    const { expr_latex, lower_latex, upper_latex, ...rest } = a;
    return {
      ...rest,
      ...(expr_latex ? { expr: ir(expr_latex, opts) } : {}),
      ...(lower_latex ? { lower: ir(lower_latex, opts) } : {}),
      ...(upper_latex ? { upper: ir(upper_latex, opts) } : {}),
    };
  });
  return {
    id,
    title: 'fixture',
    statement: [],
    definitions: (p.definitions ?? []).map((d) => ir(d, opts)),
    conditions: (p.conditions ?? []).map((c) => ir(c, opts)),
    assumptions,
    unknowns: p.unknowns ?? [],
    ...(p.independent_var ? { independent_var: p.independent_var } : {}),
    functions: p.functions ?? [],
  };
}

const unparsedSegments = (latex: string) => [{ type: 'math' as const, expr: ['Unparsed', latex] as MathJSON, notation: 'plain' as const }];

/** Payload in the exact shape the browser CAS controller sends to the worker. */
export function buildCasPayload(c: CasCase) {
  const opts: ParseOptions = { functions: c.problem.functions ?? [] };
  const lines = c.lines.map((l) => {
    const segments = l.unparsed !== undefined ? unparsedSegments(l.unparsed) : toInputSegments(segmentsFromSource(l.src, opts));
    return {
      id: l.id,
      role: l.role ?? 'step',
      segments,
      status: l.status,
      unverified_ancestors: l.unverified_ancestors ?? [],
      segment_results: segments.flatMap((s, i) =>
        s.type === 'math' ? [{ segment_index: i, status: l.status, ...(l.reason ? { reason: l.reason } : {}), ...(l.method ? { method: l.method } : {}) }] : [],
      ),
    };
  });
  const targetSegments = c.target.text !== undefined
    ? [{ type: 'text' as const, text: c.target.text }]
    : c.target.unparsed !== undefined
      ? unparsedSegments(c.target.unparsed)
      : toInputSegments(segmentsFromSource(c.target.src ?? '', opts));
  return {
    problem: buildProblem(c.problem),
    lines,
    target: { id: c.target.id, role: c.target.role ?? 'step', segments: targetSegments },
    parent_id: c.parent ?? lines[lines.length - 1]?.id ?? null,
  };
}
