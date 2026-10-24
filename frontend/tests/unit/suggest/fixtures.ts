import { SCHEMA_VERSION, segmentsFromSource, type Hash, type Line, type Notebook, type Proof, type Segment, type Status, type SuggestInput } from '@mn/contracts';

export const ZERO: Hash = `sha256:${'0'.repeat(64)}`;

export const problem = { id: 'p', title: 't', statement: [], definitions: [], conditions: [], assumptions: [], unknowns: [] };

export const proof = (status: Status, reason?: string, extra: Partial<Proof> = {}): Proof => ({
  status,
  ...(reason ? { reason } : {}),
  conditions: [],
  evidence: [],
  hints: [],
  segment_results: [],
  depends_on: [],
  depends_on_unverified: false,
  unverified_ancestors: [],
  input_hash: ZERO,
  mock: false,
  cas: { version: 'v', rules_version: '2.0.0', elapsed_ms: 1, timed_out: false },
  ...extra,
});

export const segs = (src: string): Segment[] => segmentsFromSource(src);

export const line = (id: string, state: Line['state'], extra: Partial<Line> = {}): Line => ({ id, version: 1, source: 'user', role: 'step', state, ink: [], segments: [], ...extra });

/** A settled line holding `src` with a verification result. */
export const settled = (id: string, src: string, status: Status = 'ok', reason?: string, extra: Partial<Line> = {}): Line =>
  line(id, 'SETTLED', { segments: segs(src), verified: { verification_id: `v-${id}`, input_hash: ZERO, proof: proof(status, reason) }, ...extra });

export const stroke = { id: 's1', points: [{ x: 0, y: 0, t: 0, p: 0.5 }] };

export const notebook = (lines: Line[], recoveries: Notebook['recoveries'] = []): Notebook => ({
  schema_version: SCHEMA_VERSION,
  id: '00000000-0000-4000-8000-000000000000',
  title: 't',
  mode: 'live',
  domain: 'Reals',
  lines,
  recoveries,
});

/** A SuggestInput whose context lines are the given settled lines. */
export function suggestInput(over: Partial<SuggestInput> & { lines?: Line[] } = {}): SuggestInput {
  const { lines = [], ...rest } = over;
  return {
    context: { lines: lines.map((l) => ({ id: l.id, role: l.role, source: l.source, segments: l.segments })) },
    mode: 'NEXT_STEP',
    based_on_line_id: lines.at(-1)?.id ?? 'L1',
    target_line_id: 'L9',
    rejected_hashes: [],
    ui_lang: 'en',
    ...rest,
  };
}
