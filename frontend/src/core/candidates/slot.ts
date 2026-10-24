import { hashOf, type Hash, type Meta } from '@mn/contracts';

/** What the client currently expects an arriving result to carry (the active request slot, spec §7.3). */
export type SlotMeta = Pick<
  Meta,
  'request_id' | 'notebook_id' | 'client_session_id' | 'client_epoch' | 'line_id' | 'line_version' | 'context_fingerprint'
>;

const FIELDS = [
  'request_id',
  'notebook_id',
  'client_session_id',
  'client_epoch',
  'line_id',
  'line_version',
  'context_fingerprint',
] as const satisfies readonly (keyof SlotMeta)[];

/** Names of the slot fields that differ from the result's `Job.meta`; empty when the result may be applied. */
export function mismatchedFields(slot: SlotMeta, resultMeta: SlotMeta): (keyof SlotMeta)[] {
  return FIELDS.filter((f) => slot[f] !== resultMeta[f]);
}

/** A result is applied only if all seven fields equal the active slot (spec §7.3). */
export function matchesSlot(slot: SlotMeta, resultMeta: SlotMeta): boolean {
  return mismatchedFields(slot, resultMeta).length === 0;
}

export interface FingerprintInput {
  notebookId: string;
  problem: unknown;
  /** the lines the suggestion was generated from (the prefix through the base line), not the drafts being written */
  lines: readonly { id: string; version: number }[];
  sessionId: string;
  epoch: number;
}

/**
 * context_fingerprint of a suggestion request (spec §7.3): problem, the versions of the context lines,
 * session and epoch. Unlike a whole-notebook fingerprint it does not move when the student writes on a
 * draft line, so a result that arrives mid-stroke becomes HELD instead of STALE.
 */
export function suggestFingerprint(i: FingerprintInput): Hash {
  return hashOf({ notebook: i.notebookId, problem: i.problem, lines: i.lines.map((l) => [l.id, l.version]), session: i.sessionId, epoch: i.epoch });
}
