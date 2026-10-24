/** Conversions between LLM wire segments, display segments and CAS input segments. */
import { parseMathLatex, type ParseErrorCode, type ParseOptions } from './ir/parse';
import { printSegmentLatex } from './ir/print';
import type { WireSegment } from './llm';
import type { InputSegment, Segment } from './schemas';

export type SegmentsResult =
  | { ok: true; segments: Segment[] }
  | { ok: false; code: ParseErrorCode; message: string; segment_index: number; latex: string };

const MAX_MATH_SEGMENTS = 8;
const MAX_PROSE = 4000;

/** Parse wire segments; math LaTeX is parsed to IR and re-printed so display == IR. */
export function wireToSegments(wire: readonly WireSegment[], options: ParseOptions = {}): SegmentsResult {
  const out: Segment[] = [];
  let prose = 0;
  let math = 0;
  for (const [i, w] of wire.entries()) {
    const content = w.content.trim();
    if (!content) continue;
    if (w.type === 'text') {
      prose += content.length;
      if (prose > MAX_PROSE) return { ok: false, code: 'IR_INVALID', message: 'too much prose in one line', segment_index: i, latex: '' };
      out.push({ type: 'text', text: content });
      continue;
    }
    math += 1;
    if (math > MAX_MATH_SEGMENTS) return { ok: false, code: 'IR_INVALID', message: 'more than eight formulas in one line', segment_index: i, latex: content };
    const r = parseMathLatex(content, options);
    if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message, segment_index: i, latex: content };
    out.push({ type: 'math', expr: r.expr, notation: r.notation, latex: printSegmentLatex(r.expr, r.notation) });
  }
  if (out.length > 16) return { ok: false, code: 'IR_INVALID', message: 'more than 16 segments', segment_index: 16, latex: '' };
  return { ok: true, segments: out };
}

/** Convenience for fixtures and scripted demo lines: "$...$" pieces are math, the rest is text. */
export function segmentsFromSource(source: string, options: ParseOptions = {}): Segment[] {
  const wire: WireSegment[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m.index > last) wire.push({ type: 'text', content: source.slice(last, m.index) });
    wire.push({ type: 'math', content: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < source.length) wire.push({ type: 'text', content: source.slice(last) });
  if (!source.includes('$')) wire.splice(0, wire.length, { type: 'math', content: source });
  const r = wireToSegments(wire, options);
  if (!r.ok) throw new Error(`segmentsFromSource(${JSON.stringify(source)}): ${r.message} in "${r.latex}"`);
  return r.segments;
}

export function toInputSegments(segments: readonly Segment[]): InputSegment[] {
  return segments.map((s) => (s.type === 'text' ? { type: 'text', text: s.text } : { type: 'math', expr: s.expr, notation: s.notation }));
}

export function hasUnreadable(segments: readonly Segment[]): boolean {
  const walk = (e: unknown): boolean => Array.isArray(e) && (e[0] === 'Unreadable' || e.some(walk));
  return segments.some((s) => s.type === 'math' && walk(s.expr));
}
