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
