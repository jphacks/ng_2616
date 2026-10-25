/**
 * Graph lines: a declarative description of a matplotlib figure. The model fills in the flat wire
 * form; formulas travel as LaTeX and are parsed by our own parser, so the stored spec holds only
 * MathJSON. The browser's graph worker turns the spec into a picture with fixed Python code: no
 * model-written code is ever run.
 */
import { z } from 'zod';
import { parseMathLatex, type FunctionDecl } from './ir/parse';
import type { MathJSON } from './ir/ops';

export const GRAPH_SPEC_VERSION = 1;
export const GRAPH_MAX_SERIES = 8;
export const GRAPH_MAX_POINTS = 500;

/** 2D series draw on x–y axes; 3D series on x–y–z axes. */
export const GRAPH_2D_TYPES = ['function', 'parametric', 'polar', 'implicit', 'region', 'contour', 'vector_field', 'points'] as const;
export const GRAPH_3D_TYPES = ['surface', 'parametric_surface', 'curve3d', 'points3d'] as const;
export const GraphSeriesTypeSchema = z.enum([...GRAPH_2D_TYPES, ...GRAPH_3D_TYPES]);
export type GraphSeriesType = z.infer<typeof GraphSeriesTypeSchema>;

/** Which part of a complex value is drawn (a real value is its own real part). */
export const GraphPartSchema = z.enum(['re', 'im', 'abs', 'abs2']);

/** The formulas each series type needs, by slot name. */
export const GRAPH_SLOTS: Record<GraphSeriesType, readonly GraphSlot[]> = {
  function: ['y'],
  parametric: ['x', 'y'],
  polar: ['r'],
  implicit: ['f'],
  region: ['f'],
  contour: ['z'],
  vector_field: ['u', 'v'],
  points: [],
  surface: ['z'],
  parametric_surface: ['x', 'y', 'z'],
  curve3d: ['x', 'y', 'z'],
  points3d: [],
};
/** How many free parameters (beyond the axes' x and y) each series type sweeps. */
export const GRAPH_PARAMS: Record<GraphSeriesType, number> = {
  function: 0,
  parametric: 1,
  polar: 1,
  implicit: 0,
  region: 0,
  contour: 0,
  vector_field: 0,
  points: 0,
  surface: 0,
  parametric_surface: 2,
  curve3d: 1,
  points3d: 0,
};

export const GraphSlotSchema = z.enum(['x', 'y', 'z', 'r', 'f', 'u', 'v']);
export type GraphSlot = z.infer<typeof GraphSlotSchema>;

const NameSchema = z.string().min(1).max(32);
const RangeSchema = z.tuple([z.number().finite(), z.number().finite()]).refine(([a, b]) => a < b, 'range must run from low to high');
const LabelSchema = z.string().max(80);

// ------------------------------------------------------------------ wire (what the model returns)

const WireParamSchema = z.object({ name: NameSchema, min: z.number().finite(), max: z.number().finite() });

export const GraphWireSeriesSchema = z.object({
  type: GraphSeriesTypeSchema,
  label: LabelSchema.optional(),
  /** LaTeX for each formula the type needs; a type ignores the slots it does not use */
  x: z.string().max(2000).optional(),
  y: z.string().max(2000).optional(),
  z: z.string().max(2000).optional(),
  r: z.string().max(2000).optional(),
  f: z.string().max(2000).optional(),
  u: z.string().max(2000).optional(),
  v: z.string().max(2000).optional(),
  params: z.array(WireParamSchema).max(2).optional(),
  points: z.array(z.array(z.number().finite()).min(2).max(3)).max(GRAPH_MAX_POINTS).optional(),
  part: GraphPartSchema.optional(),
  filled: z.boolean().optional(),
});

export const GraphWireSchema = z.object({
  has_graph: z.boolean(),
  kind: z.enum(['2d', '3d']),
  title: z.string().max(120),
  x_label: LabelSchema,
  y_label: LabelSchema,
  z_label: LabelSchema.optional(),
  x_range: z.array(z.number().finite()).max(2),
  y_range: z.array(z.number().finite()).max(2).optional(),
  z_range: z.array(z.number().finite()).max(2).optional(),
  constants: z.array(z.object({ name: NameSchema, value: z.number().finite() })).max(16).optional(),
  aspect: z.enum(['auto', 'equal']).optional(),
  elev: z.number().finite().optional(),
  azim: z.number().finite().optional(),
  series: z.array(GraphWireSeriesSchema).max(GRAPH_MAX_SERIES),
});
export type GraphWire = z.infer<typeof GraphWireSchema>;
export type GraphWireSeries = z.infer<typeof GraphWireSeriesSchema>;

const rangeJson = { type: 'array', items: { type: 'number' }, maxItems: 2 } as const;
const formulaJson = { type: 'string' } as const;

/** JSON Schema for the provider's structured output (flat; per-type rules are checked after). */
export const GRAPH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    has_graph: { type: 'boolean' },
    kind: { type: 'string', enum: ['2d', '3d'] },
    title: { type: 'string' },
    x_label: { type: 'string' },
    y_label: { type: 'string' },
    z_label: { type: 'string' },
    x_range: rangeJson,
    y_range: rangeJson,
    z_range: rangeJson,
    constants: {
      type: 'array',
      maxItems: 16,
      items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'number' } }, required: ['name', 'value'], additionalProperties: false },
    },
    aspect: { type: 'string', enum: ['auto', 'equal'] },
    elev: { type: 'number' },
    azim: { type: 'number' },
    series: {
      type: 'array',
      maxItems: GRAPH_MAX_SERIES,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...GRAPH_2D_TYPES, ...GRAPH_3D_TYPES] },
          label: { type: 'string' },
          x: formulaJson,
          y: formulaJson,
          z: formulaJson,
          r: formulaJson,
          f: formulaJson,
          u: formulaJson,
          v: formulaJson,
          params: {
            type: 'array',
            maxItems: 2,
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' } },
              required: ['name', 'min', 'max'],
              additionalProperties: false,
            },
          },
          points: { type: 'array', maxItems: GRAPH_MAX_POINTS, items: { type: 'array', items: { type: 'number' }, maxItems: 3 } },
          part: { type: 'string', enum: ['re', 'im', 'abs', 'abs2'] },
          filled: { type: 'boolean' },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
  required: ['has_graph', 'kind', 'title', 'x_label', 'y_label', 'x_range', 'series'],
  additionalProperties: false,
} as const;

// ------------------------------------------------------------------ spec (what a graph line stores)

const FormulaSchema = z.object({ latex: z.string().max(2000), expr: z.custom<MathJSON>((v) => v !== undefined) });

export const GraphSeriesSchema = z.object({
  type: GraphSeriesTypeSchema,
  label: LabelSchema.optional(),
  formulas: z.partialRecord(GraphSlotSchema, FormulaSchema),
  params: z.array(z.object({ name: NameSchema, range: RangeSchema })).max(2),
  points: z.array(z.array(z.number().finite()).min(2).max(3)).max(GRAPH_MAX_POINTS).optional(),
  part: GraphPartSchema,
  filled: z.boolean(),
});

const AxisSchema = z.object({ label: LabelSchema, range: RangeSchema.optional() });

export const GraphSpecSchema = z.object({
  v: z.literal(GRAPH_SPEC_VERSION),
  kind: z.enum(['2d', '3d']),
  title: z.string().max(120),
  axes: z.object({ x: AxisSchema.extend({ range: RangeSchema }), y: AxisSchema, z: AxisSchema.optional() }),
  constants: z.record(NameSchema, z.number().finite()),
  aspect: z.enum(['auto', 'equal']),
  view: z.object({ elev: z.number().finite(), azim: z.number().finite() }).optional(),
  series: z.array(GraphSeriesSchema).min(1).max(GRAPH_MAX_SERIES),
});
export type GraphSpec = z.infer<typeof GraphSpecSchema>;
export type GraphSeries = z.infer<typeof GraphSeriesSchema>;

export type GraphFromWire = { ok: true; spec: GraphSpec } | { ok: false; message: string };

const DEFAULT_PARAM: Partial<Record<GraphSeriesType, { name: string; range: [number, number] }>> = {
  parametric: { name: 't', range: [0, 2 * Math.PI] },
  polar: { name: 'theta', range: [0, 2 * Math.PI] },
  curve3d: { name: 't', range: [0, 2 * Math.PI] },
};

function range(v: readonly number[] | undefined, what: string): [number, number] | undefined | string {
  if (!v || v.length === 0) return undefined;
  if (v.length !== 2 || !(v[0]! < v[1]!)) return `${what} must be two numbers, low then high`;
  return [v[0]!, v[1]!];
}

/**
 * Checks a model's graph against the per-type rules and parses every formula. The result holds
 * MathJSON only; anything the parser refuses rejects the whole graph.
 */
export function graphFromWire(wire: GraphWire, options: { functions?: readonly FunctionDecl[] } = {}): GraphFromWire {
  if (!wire.has_graph) return { ok: false, message: 'no graph' };
  if (wire.series.length === 0) return { ok: false, message: 'a graph needs at least one series' };
  const xr = range(wire.x_range, 'x_range');
  if (typeof xr === 'string') return { ok: false, message: xr };
  const yr = range(wire.y_range, 'y_range');
  if (typeof yr === 'string') return { ok: false, message: yr };
  const zr = range(wire.z_range, 'z_range');
  if (typeof zr === 'string') return { ok: false, message: zr };
  const series: GraphSeries[] = [];
  for (const [i, s] of wire.series.entries()) {
    const is3d = (GRAPH_3D_TYPES as readonly string[]).includes(s.type);
    if (is3d !== (wire.kind === '3d')) return { ok: false, message: `series ${i + 1}: ${s.type} does not belong on a ${wire.kind} graph` };
    const formulas: GraphSeries['formulas'] = {};
    for (const slot of GRAPH_SLOTS[s.type]) {
      const latex = s[slot]?.trim();
      if (!latex) return { ok: false, message: `series ${i + 1}: ${s.type} needs ${slot}` };
      const parsed = parseMathLatex(latex, { functions: options.functions });
      if (!parsed.ok) return { ok: false, message: `series ${i + 1} ${slot}: ${parsed.error.message}` };
      formulas[slot] = { latex, expr: parsed.expr };
    }
    const wanted = GRAPH_PARAMS[s.type];
    const given = (s.params ?? []).slice(0, wanted);
    const params: GraphSeries['params'] = [];
    for (const p of given) {
      if (!(p.min < p.max)) return { ok: false, message: `series ${i + 1}: parameter ${p.name} must run from low to high` };
      params.push({ name: p.name, range: [p.min, p.max] });
    }
    if (params.length < wanted) {
      const fallback = DEFAULT_PARAM[s.type];
      if (!fallback || wanted - params.length > 1) return { ok: false, message: `series ${i + 1}: ${s.type} needs ${wanted} parameter(s)` };
      params.push(fallback);
    }
    if ((s.type === 'points' || s.type === 'points3d') && !s.points?.length) return { ok: false, message: `series ${i + 1}: ${s.type} needs points` };
    const dims = s.type === 'points3d' ? 3 : 2;
    if (s.points?.some((p) => p.length !== dims)) return { ok: false, message: `series ${i + 1}: every point needs ${dims} coordinates` };
    series.push({
      type: s.type,
      ...(s.label?.trim() ? { label: s.label.trim() } : {}),
      formulas,
      params,
      ...(s.points?.length && (s.type === 'points' || s.type === 'points3d') ? { points: s.points } : {}),
      part: s.part ?? 're',
      filled: s.filled ?? s.type === 'region',
    });
  }
  const spec: GraphSpec = {
    v: GRAPH_SPEC_VERSION,
    kind: wire.kind,
    title: wire.title.trim(),
    axes: {
      x: { label: wire.x_label, range: xr ?? [-5, 5] },
      y: { label: wire.y_label, ...(yr ? { range: yr } : {}) },
      ...(wire.kind === '3d' ? { z: { label: wire.z_label ?? 'z', ...(zr ? { range: zr } : {}) } } : {}),
    },
    constants: Object.fromEntries((wire.constants ?? []).map((c) => [c.name, c.value])),
    aspect: wire.aspect ?? 'auto',
    ...(wire.kind === '3d' ? { view: { elev: wire.elev ?? 25, azim: wire.azim ?? -60 } } : {}),
    series,
  };
  const checked = GraphSpecSchema.safeParse(spec);
  return checked.success ? { ok: true, spec: checked.data } : { ok: false, message: checked.error.issues[0]?.message ?? 'invalid graph' };
}

/** The graph a line carries, if any (graph lines keep it under extensions.graph). */
export function graphOf(line: { extensions?: Record<string, unknown> }): GraphSpec | undefined {
  const parsed = GraphSpecSchema.safeParse(line.extensions?.graph);
  return parsed.success ? parsed.data : undefined;
}
