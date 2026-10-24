import {
  ProofSchema,
  RULES_VERSION,
  hashOf,
  toInputSegments,
  type Hash,
  type InputSegment,
  type Line,
  type Notebook,
  type Proof,
  type Role,
  type Status,
} from '@mn/contracts';
import { contextLinesFor, parentFor, proofOf } from '@/core/notebook/model';

export interface CasContextLine {
  id: string;
  role: Role;
  segments: InputSegment[];
  status: Status;
  unverified_ancestors: string[];
  segment_results: { segment_index: number; status: Status; reason?: string; method?: string; goal?: string }[];
}

export interface CasPayload {
  lines: CasContextLine[];
  target: { id: string; role: Role; segments: InputSegment[]; revision_of?: string; recovery_root_id?: string };
  parent_id: string | null;
}

/** What cas_core returns; the controller adds input_hash, mock and cas versions. */
export type CasRawProof = Omit<Proof, 'input_hash' | 'mock' | 'cas'> & { elapsed_ms?: number; rules_version?: string };

function contextLine(l: Line): CasContextLine {
  const p = proofOf(l);
  return {
    id: l.id,
    role: l.role,
    segments: toInputSegments(l.segments),
    status: p?.status ?? 'unknown',
    unverified_ancestors: p?.unverified_ancestors ?? [],
    segment_results: (p?.segment_results ?? []).map((r) => ({
      segment_index: r.segment_index,
      status: r.status,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.method ? { method: r.method } : {}),
      ...(r.goal ? { goal: r.goal } : {}),
    })),
  };
}

/** Payload for an existing line: only active, settled lines above it enter its context. */
export function payloadForLine(nb: Notebook, lineId: string, extra: Line[] = []): CasPayload {
  const target = nb.lines.find((l) => l.id === lineId)!;
  const ctx = [...contextLinesFor(nb, lineId), ...extra];
  const parent = extra.length ? extra[extra.length - 1] : parentFor(nb, lineId);
  return {
    lines: ctx.map(contextLine),
    target: {
      id: target.id,
      role: target.role,
      segments: toInputSegments(target.segments),
      ...(target.revision_of ? { revision_of: target.revision_of } : {}),
      ...(target.recovery_root_id ? { recovery_root_id: target.recovery_root_id } : {}),
    },
    parent_id: parent?.id ?? null,
  };
}

/** Payload for a suggested line that would be inserted after `afterLines`. */
export function payloadForCandidate(nb: Notebook, contextLines: Line[], target: CasPayload['target']): CasPayload {
  const parent = [...contextLines].reverse().find((l) => l.segments.some((s) => s.type === 'math') && proofOf(l)?.status !== 'wrong');
  return { lines: contextLines.map(contextLine), target, parent_id: parent?.id ?? null };
}

/** Semantic hash (spec §7.3): mathematical content only, no ink, timings or transport ids. */
export function semanticHash(nb: Notebook, payload: CasPayload): Hash {
  return hashOf({
    notebook_id: nb.id,
    domain: nb.domain,
    mode: nb.mode,
    ancestors: payload.lines.map((l) => ({ id: l.id, role: l.role, segments: l.segments, status: l.status, unverified: l.unverified_ancestors })),
  });
}

export function inputHash(nb: Notebook, payload: CasPayload, casVersion: string): Hash {
  return hashOf({ rules: RULES_VERSION, cas: casVersion, semantic: semanticHash(nb, payload), target: payload.target, parent_id: payload.parent_id });
}

export function contextFingerprint(nb: Notebook, sessionId: string, epoch: number): Hash {
  return hashOf({
    notebook: nb.id,
    lines: nb.lines.map((l) => [l.id, l.version]),
    session: sessionId,
    epoch,
  });
}

/** Turn the worker's answer into a schema-valid Proof; anything malformed becomes CAS_ERROR. */
export function composeProof(raw: CasRawProof | null, opts: { inputHash: Hash; mock: boolean; casVersion: string; elapsedMs: number; timedOut: boolean; reason?: string }): Proof {
  const base: Proof = {
    status: 'unknown',
    reason: opts.reason ?? 'CAS_ERROR',
    conditions: [],
    evidence: [],
    hints: [],
    segment_results: [],
    depends_on: [],
    depends_on_unverified: false,
    unverified_ancestors: [],
    input_hash: opts.inputHash,
    mock: opts.mock,
    cas: { version: opts.casVersion, rules_version: RULES_VERSION, elapsed_ms: Math.round(opts.elapsedMs), timed_out: opts.timedOut },
  };
  if (!raw) return base;
  const { elapsed_ms: _e, rules_version: _r, ...fields } = raw as CasRawProof & { _trace?: string };
  delete (fields as { _trace?: string })._trace;
  const parsed = ProofSchema.safeParse({ ...base, ...fields, input_hash: opts.inputHash, mock: opts.mock, cas: base.cas });
  return parsed.success ? parsed.data : { ...base, conditions: [parsed.error.issues[0]?.message ?? 'malformed CAS result'] };
}
