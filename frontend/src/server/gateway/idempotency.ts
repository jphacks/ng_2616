import 'server-only';
import type { Job } from '@mn/contracts';

/**
 * Best-effort, in-memory idempotency for direct mode: a retried request with the same key and
 * input returns the original job instead of paying for a second LLM call (spec §7.2).
 * The backend's SQLite job store replaces this in relay mode.
 */
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 1000;

interface Entry {
  digest: string;
  at: number;
  job: Promise<Job>;
}

const entries = new Map<string, Entry>();

export type Lookup = { kind: 'hit'; job: Promise<Job> } | { kind: 'conflict' } | { kind: 'miss' };

export function lookup(key: string, digest: string): Lookup {
  const e = entries.get(key);
  if (!e || Date.now() - e.at > TTL_MS) return { kind: 'miss' };
  return e.digest === digest ? { kind: 'hit', job: e.job } : { kind: 'conflict' };
}

export function remember(key: string, digest: string, job: Promise<Job>) {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest) entries.delete(oldest);
  }
  entries.set(key, { digest, at: Date.now(), job });
  // failed jobs may be retried with the same key
  job.then((j) => {
    if (j.state !== 'succeeded') entries.delete(key);
  }, () => entries.delete(key));
}
