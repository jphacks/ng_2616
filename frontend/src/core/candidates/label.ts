import type { Verified } from '@mn/contracts';

/**
 * The first unverified line an ok candidate depends on, or null. Such a candidate is shown like a line is:
 * "local step consistent (unverified: line N)" instead of "verified" (spec §10, P-05).
 */
export function candidateAncestorId(lines: readonly { verified?: Verified }[]): string | null {
  for (const l of lines) {
    const p = l.verified?.proof;
    if (p?.status === 'ok' && p.unverified_ancestors.length > 0) return p.unverified_ancestors[0]!;
  }
  return null;
}
