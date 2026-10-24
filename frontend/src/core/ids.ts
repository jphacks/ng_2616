const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id matching the spec's line/stroke id pattern [A-Za-z0-9_-]{1,64}. */
export function shortId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = prefix;
  for (const b of bytes) s += ALPHABET[b % 36];
  return s;
}

export const uuid = () => crypto.randomUUID();
