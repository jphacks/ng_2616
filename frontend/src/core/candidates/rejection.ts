import type { Hash, SuggestMode } from '@mn/contracts';

/** COMPLETE_RHS fills an existing line, NEXT_STEP creates a new one. */
export type TargetKind = 'existing' | 'new';

export const targetKindOf = (mode: SuggestMode): TargetKind => (mode === 'COMPLETE_RHS' ? 'existing' : 'new');

/**
 * Key of the in-memory rejection history (spec §7.3: "rejection history is context-scoped"):
 * the notebook's semantic hash, the mode and the kind of target. Never persisted.
 */
export function rejectionKey(semanticHash: Hash, mode: SuggestMode, target: TargetKind = targetKindOf(mode)): string {
  return `${semanticHash}:${mode}:${target}`;
}

/** What the student has rejected in one context: candidate hashes (sent to the server) and their LaTeX (sent to the model). */
export interface RejectionEntry {
  hashes: string[];
  latex: string[];
}

/** In-memory rejection history, one entry per `rejectionKey`. Never persisted. */
export type RejectionHistory = Record<string, RejectionEntry>;

const EMPTY: RejectionEntry = { hashes: [], latex: [] };

export function rejectionsFor(history: RejectionHistory, key: string): RejectionEntry {
  return history[key] ?? EMPTY;
}

/** Only a finished candidate (one the student could see or adopt) is worth remembering as rejected. */
export function isRecordable(state: string): boolean {
  return state === 'READY' || state === 'HELD';
}

/** Returns a new history with `hash` recorded under `key`; an empty hash or a repeat changes nothing. */
export function addRejection(history: RejectionHistory, key: string, hash: string, latex: string): RejectionHistory {
  if (!hash) return history;
  const cur = rejectionsFor(history, key);
  if (cur.hashes.includes(hash)) return history;
  return { ...history, [key]: { hashes: [...cur.hashes, hash], latex: [...cur.latex, latex] } };
}
