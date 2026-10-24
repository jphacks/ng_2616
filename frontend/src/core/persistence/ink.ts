import { hashOf, type Notebook, type Stroke } from '@mn/contracts';

export type InkHash = `sha256:${string}`;

/** A notebook as stored in the cloud: lines without ink, plus each line's ink by content hash. */
export interface SplitNotebook {
  snapshot: Notebook;
  /** line id → ink hash; lines without ink are absent */
  index: Record<string, InkHash>;
  inks: Map<InkHash, Stroke[]>;
}

// Ink arrays are replaced, never mutated, so a hash can be cached per array.
const hashes = new WeakMap<readonly Stroke[], InkHash>();

export function inkHash(ink: readonly Stroke[]): InkHash {
  let h = hashes.get(ink);
  if (!h) {
    h = hashOf(ink) as InkHash;
    hashes.set(ink, h);
  }
  return h;
}

export function splitInk(nb: Notebook): SplitNotebook {
  const index: Record<string, InkHash> = {};
  const inks = new Map<InkHash, Stroke[]>();
  const lines = nb.lines.map((l) => {
    if (l.ink.length === 0) return l;
    const h = inkHash(l.ink);
    index[l.id] = h;
    inks.set(h, l.ink);
    return { ...l, ink: [] };
  });
  return { snapshot: { ...nb, lines }, index, inks };
}

/** Puts ink back; a line whose ink is missing keeps an empty drawing rather than failing the open. */
export function joinInk(snapshot: Notebook, index: Record<string, string>, inks: ReadonlyMap<string, Stroke[]>): Notebook {
  return {
    ...snapshot,
    lines: snapshot.lines.map((l) => {
      const h = index[l.id];
      const ink = h ? inks.get(h) : undefined;
      if (!ink) return l;
      hashes.set(ink, h as InkHash);
      return { ...l, ink };
    }),
  };
}
