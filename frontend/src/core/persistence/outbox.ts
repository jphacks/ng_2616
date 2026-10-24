'use client';

import { hashOf, NotebookSchema, type Notebook } from '@mn/contracts';
import Dexie, { type EntityTable } from 'dexie';
import { uuid } from '@/core/ids';
import { openNotebookIds, settleClosedNotebooks } from './autosave';
import { getRepository, normalizeOpened, RepoError, type NotebookRepository } from './repo';

/** Edits not yet confirmed by the cloud, written ahead of every cloud save (spec §14.5). */
export interface PendingEdit {
  notebook_id: string;
  snapshot: Notebook;
  /** cloud revision the edits are based on; null for a notebook the cloud has never seen */
  base_revision: number | null;
  saved_at: string;
}

class OutboxDb extends Dexie {
  pending!: EntityTable<PendingEdit, 'notebook_id'>;
  constructor(owner: string) {
    super(`mn_outbox_${owner}`);
    this.version(1).stores({ pending: 'notebook_id, saved_at' });
  }
}

const dbs = new Map<string, OutboxDb>();
function outbox(ownerId: string): OutboxDb {
  let db = dbs.get(ownerId);
  if (!db) {
    db = new OutboxDb(ownerId);
    dbs.set(ownerId, db);
  }
  return db;
}

const entry = (nb: Notebook, baseRevision: number | null): PendingEdit => ({ notebook_id: nb.id, snapshot: nb, base_revision: baseRevision, saved_at: new Date().toISOString() });

export async function putPending(ownerId: string, nb: Notebook, baseRevision: number | null) {
  await outbox(ownerId).pending.put(entry(nb, baseRevision));
}

/** Opens the outbox ahead of time, so a write while the page unloads can start at once. */
export function openOutbox(ownerId: string) {
  void outbox(ownerId).open().catch((e) => console.warn('[outbox] unavailable', e));
}

/**
 * Write issued synchronously and committed explicitly, for pagehide / visibilitychange:
 * a promise-chained write can be aborted when the page goes away before it starts.
 */
export function putPendingNow(ownerId: string, nb: Notebook, baseRevision: number | null): boolean {
  const db = outbox(ownerId);
  if (!db.isOpen()) return false;
  try {
    const tx = db.backendDB().transaction('pending', 'readwrite');
    tx.objectStore('pending').put(entry(nb, baseRevision));
    tx.commit?.();
    return true;
  } catch (e) {
    console.warn('[outbox] immediate write failed', e);
    return false;
  }
}

export async function getPending(ownerId: string, id: string): Promise<PendingEdit | undefined> {
  return outbox(ownerId).pending.get(id);
}

export async function clearPending(ownerId: string, id: string) {
  await outbox(ownerId).pending.delete(id);
}

export async function countPending(ownerId: string): Promise<number> {
  return outbox(ownerId).pending.count();
}

export async function deleteOutbox(ownerId: string) {
  dbs.get(ownerId)?.close();
  dbs.delete(ownerId);
  await Dexie.delete(`mn_outbox_${ownerId}`);
}

const sameNotebook = (a: Notebook, b: Notebook) => hashOf(normalizeOpened(a)) === hashOf(normalizeOpened(b));

export type PushOutcome = { kind: 'saved'; revision: number } | { kind: 'copied'; id: string; title: string } | { kind: 'unchanged' } | { kind: 'failed'; reason: string };

/** What reconciling the outbox reads and writes (injectable for tests). */
export interface PushDeps {
  repo: Pick<NotebookRepository, 'load' | 'save'>;
  list(): Promise<PendingEdit[]>;
  get(id: string): Promise<PendingEdit | undefined>;
  clear(id: string): Promise<void>;
}

const depsFor = (ownerId: string): PushDeps => ({
  repo: getRepository(ownerId),
  list: () => outbox(ownerId).pending.toArray(),
  get: (id) => getPending(ownerId, id),
  clear: (id) => clearPending(ownerId, id),
});

const queues = new Map<string, Promise<unknown>>();

/**
 * One reconciliation at a time per user: two pushes of the same entry would both save at its
 * base revision, and the one that lost would keep the very same edits as a copy.
 */
function serially<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(ownerId) ?? Promise.resolve()).then(fn);
  queues.set(ownerId, run.catch(() => undefined));
  return run;
}

/** Sends the outbox entry of one notebook, as it is now (an earlier push may have sent it). */
async function pushOne(deps: PushDeps, id: string, copyTitle: (title: string) => string): Promise<PushOutcome> {
  const entry = await deps.get(id);
  if (!entry) return { kind: 'unchanged' };
  const parsed = NotebookSchema.safeParse(entry.snapshot);
  if (!parsed.success) {
    await deps.clear(id);
    return { kind: 'failed', reason: 'invalid' };
  }
  const nb = parsed.data;
  const cloud = await deps.repo.load(nb.id);
  if (cloud && sameNotebook(cloud.notebook, nb)) {
    await deps.clear(nb.id);
    return { kind: 'unchanged' };
  }
  if ((cloud?.revision ?? null) === entry.base_revision || (!cloud && entry.base_revision !== null)) {
    // in place; a notebook deleted elsewhere comes back rather than losing the edits
    const res = await deps.repo.save(nb, cloud?.revision ?? null);
    if (res.ok) {
      await deps.clear(nb.id);
      return { kind: 'saved', revision: res.revision };
    }
    if (res.reason !== 'conflict') return { kind: 'failed', reason: res.reason };
    // saved meanwhile from elsewhere: when that was these very edits, there is nothing to keep
    const now = await deps.repo.load(nb.id);
    if (now && sameNotebook(now.notebook, nb)) {
      await deps.clear(nb.id);
      return { kind: 'unchanged' };
    }
  }
  const copy = { ...nb, id: uuid(), title: copyTitle(nb.title).slice(0, 200) };
  const res = await deps.repo.save(copy, null);
  if (!res.ok) return { kind: 'failed', reason: res.reason };
  await deps.clear(nb.id);
  return { kind: 'copied', id: copy.id, title: copy.title };
}

/**
 * Sends one notebook's pending edit. Based on the cloud's current revision (or never uploaded):
 * saved in place. The cloud moved on meanwhile: kept as a separate copy, never overwriting either side.
 */
export async function pushPending(ownerId: string, id: string, copyTitle: (title: string) => string, deps = depsFor(ownerId)): Promise<PushOutcome> {
  await settleClosedNotebooks();
  return serially(ownerId, () => pushOne(deps, id, copyTitle));
}

/** Pushes every pending edit except the notebooks listed in `skip` and those open in an editor. */
export async function pushAllPending(ownerId: string, copyTitle: (title: string) => string, skip: ReadonlySet<string> = new Set(), deps = depsFor(ownerId)): Promise<PushOutcome[]> {
  // a notebook just closed may still be saving: what it leaves behind is what needs pushing
  await settleClosedNotebooks();
  return serially(ownerId, async () => {
    const open = openNotebookIds();
    const out: PushOutcome[] = [];
    for (const e of await deps.list()) {
      if (skip.has(e.notebook_id) || open.has(e.notebook_id)) continue;
      try {
        out.push(await pushOne(deps, e.notebook_id, copyTitle));
      } catch (err) {
        out.push({ kind: 'failed', reason: err instanceof RepoError ? err.code : String(err) });
      }
    }
    return out;
  });
}

export interface Opened {
  notebook: Notebook;
  revision: number | null;
  /** the opened state has edits the cloud does not have yet */
  dirty: boolean;
  /** offline: opened from this device's unsent copy */
  offline?: boolean;
  /** unsent edits from an earlier session could not go in place and were saved as this copy */
  recoveredCopy?: string;
}

/** Opens a notebook from the cloud, reconciling it with edits this device has not sent yet. */
export async function openNotebook(ownerId: string, id: string, copyTitle: (title: string) => string, deps = depsFor(ownerId)): Promise<Opened | null> {
  // reopened right after closing: its last save, or a push of it, may still be running
  await settleClosedNotebooks();
  return serially(ownerId, async () => {
    const pending = await deps.get(id).catch(() => undefined);
    let cloud: Awaited<ReturnType<PushDeps['repo']['load']>>;
    try {
      cloud = await deps.repo.load(id);
    } catch (e) {
      if (pending && (!(e instanceof RepoError) || e.code === 'NETWORK')) {
        return { notebook: normalizeOpened(pending.snapshot), revision: pending.base_revision, dirty: true, offline: true };
      }
      throw e;
    }
    if (!pending) return cloud && { ...cloud, dirty: false };
    if (cloud && sameNotebook(cloud.notebook, pending.snapshot)) {
      await deps.clear(id);
      return { ...cloud, dirty: false };
    }
    if (!cloud || cloud.revision === pending.base_revision) {
      // carry on where this device left off; autosave sends it
      return { notebook: normalizeOpened(pending.snapshot), revision: cloud?.revision ?? null, dirty: true };
    }
    const res = await pushOne(deps, id, copyTitle);
    return { ...cloud, dirty: false, recoveredCopy: res.kind === 'copied' ? res.title : undefined };
  });
}
