/** Turn LaTeX fixtures into IR payloads (shared by the emit script and the CAS oracle). */
import { declaredFunctions } from '../src/declarations';
import type { ParseOptions } from '../src/ir';
import { segmentsFromSource, toInputSegments } from '../src/segments';
import type { MathJSON } from '../src';
import type { CasCase, FixtureLine } from './cas-cases';

const unparsedSegments = (latex: string) => [{ type: 'math' as const, expr: ['Unparsed', latex] as MathJSON, notation: 'plain' as const }];

/** Payload in the exact shape the browser CAS controller sends to the worker. */
export function buildCasPayload(c: CasCase) {
  const top: FixtureLine[] = [
    ...(c.given ?? []).map((latex, i): FixtureLine => ({ id: `G${i + 1}`, src: `$${latex}$`, role: 'premise', status: 'none', reason: 'PREMISE' })),
    ...(c.definitions ?? []).map((latex, i): FixtureLine => ({ id: `D${i + 1}`, src: `$${latex}$`, role: 'definition', status: 'none', reason: 'DEFINITION' })),
  ];
  // a declaration holds for the whole page, as in the notebook
  const written = [...top, ...c.lines].filter((l) => l.unparsed === undefined).map((l) => l.src);
  if (c.target.src) written.push(c.target.src);
  const opts: ParseOptions = { functions: declaredFunctions(written.map((src) => ({ state: 'SETTLED', segments: segmentsFromSource(src) }))) };
  const lines = [...top, ...c.lines].map((l) => {
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
    lines,
    target: { id: c.target.id, role: c.target.role ?? 'step', segments: targetSegments },
    parent_id: c.parent ?? lines[lines.length - 1]?.id ?? null,
  };
}
