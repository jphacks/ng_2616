'use client';

import { NotebookSchema, type Notebook } from '@mn/contracts';
import Dexie, { type EntityTable } from 'dexie';
import { DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { buildPreview, previewOf, PREVIEW_LINES, type NotebookPreview } from '@/core/notebook/preview';

export interface NotebookSummary {
  id: string;
  title: string;
  updated_at: string;
  revision: number;
  mode?: string;
  demo?: boolean;
  preview?: NotebookPreview;
}

// a few leading lines (superseded ones are skipped) instead of the whole snapshot
const PREVIEW_COLUMNS = [
  'problem:snapshot->problem',
  ...Array.from({ length: PREVIEW_LINES + 2 }, (_, i) => `l${i}:snapshot->lines->${i}`),
].join(',');
// a plain string: the column list is built at runtime, so the typed select parser cannot read it
const LIST_COLUMNS: string = `id,title,updated_at,revision,mode:snapshot->>mode,demo:snapshot->extensions->demo->>script,${PREVIEW_COLUMNS}`;

export type SaveResult = { ok: true; revision: number } | { ok: false; reason: 'conflict' | 'too_large' | 'error'; message?: string };

export interface NotebookRepository {
  readonly kind: 'cloud' | 'local';
  list(): Promise<NotebookSummary[]>;
  load(id: string): Promise<{ notebook: Notebook; revision: number } | null>;
  /** Insert (expectedRevision null) or update by id + expected revision; zero rows = conflict. */
  save(nb: Notebook, expectedRevision: number | null): Promise<SaveResult>;
  remove(id: string): Promise<void>;
}

export class RepoError extends Error {
  constructor(public code: 'MIGRATION_MISSING' | 'SNAPSHOT_INVALID' | 'AUTH' | 'NETWORK', message: string) {
    super(message);
  }
}

const MAX_SNAPSHOT = 8 * 1024 * 1024;

function validate(raw: unknown): Notebook {
  const r = NotebookSchema.safeParse(raw);
  if (!r.success) throw new RepoError('SNAPSHOT_INVALID', r.error.issues[0]?.message ?? 'invalid snapshot');
  return r.data;
}

/** Processing states never survive a save/open cycle: they become explicit retry states. */
export function normalizeOpened(nb: Notebook): Notebook {
  return {
    ...nb,
    lines: nb.lines.map((l) =>
      l.state === 'RECOGNIZING' || l.state === 'VERIFYING'
        ? { ...l, state: 'RECOGNIZE_FAILED', failure: { stage: l.state === 'VERIFYING' ? 'verify' : 'recognize', code: 'INTERRUPTED' } }
        : l,
    ),
  };
}

function migrationMissing(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === 'PGRST205' || e.code === '42P01' || /mn_notebooks/.test(e.message ?? '') && /not find|does not exist/.test(e.message ?? ''));
}

class SupabaseRepo implements NotebookRepository {
  readonly kind = 'cloud' as const;
  constructor(private ownerId: string) {}

  private get table() {
    return supabaseBrowser().from('mn_notebooks');
  }

  async list() {
    const { data, error } = await this.table
      .select(LIST_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (migrationMissing(error)) throw new RepoError('MIGRATION_MISSING', error!.message);
    if (error) throw new RepoError('NETWORK', error.message);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      updated_at: r.updated_at as string,
      revision: r.revision as number,
      mode: (r.mode as string | null) ?? undefined,
      demo: !!r.demo,
      preview: buildPreview(
        r.problem as { title?: unknown; statement?: unknown } | null,
        Array.from({ length: PREVIEW_LINES + 2 }, (_, i) => r[`l${i}`]).filter((l) => l != null),
      ),
    }));
  }

  async load(id: string) {
    const { data, error } = await this.table.select('snapshot,revision').eq('id', id).maybeSingle();
    if (migrationMissing(error)) throw new RepoError('MIGRATION_MISSING', error!.message);
    if (error) throw new RepoError('NETWORK', error.message);
    if (!data) return null;
    return { notebook: normalizeOpened(validate(data.snapshot)), revision: data.revision as number };
  }

  async save(nb: Notebook, expectedRevision: number | null): Promise<SaveResult> {
    const snapshot = validate(nb);
    if (JSON.stringify(snapshot).length > MAX_SNAPSHOT) return { ok: false, reason: 'too_large' };
    if (expectedRevision === null) {
      const { error } = await this.table.insert({ id: nb.id, owner_id: this.ownerId, title: nb.title, schema_version: nb.schema_version, revision: 1, snapshot });
      if (migrationMissing(error)) throw new RepoError('MIGRATION_MISSING', error!.message);
      if (error) return { ok: false, reason: error.code === '23505' ? 'conflict' : 'error', message: error.message };
      return { ok: true, revision: 1 };
    }
    const { data, error } = await this.table
      .update({ title: nb.title, snapshot, revision: expectedRevision + 1 })
      .eq('id', nb.id)
      .eq('owner_id', this.ownerId)
      .eq('revision', expectedRevision)
      .select('revision');
    if (migrationMissing(error)) throw new RepoError('MIGRATION_MISSING', error!.message);
    if (error) return { ok: false, reason: 'error', message: error.message };
    if (!data || data.length === 0) return { ok: false, reason: 'conflict' };
    return { ok: true, revision: data[0]!.revision as number };
  }

  async remove(id: string) {
    const { error } = await this.table.delete().eq('id', id);
    if (error) throw new RepoError('NETWORK', error.message);
  }
}

interface LocalRow {
  id: string;
  title: string;
  updated_at: string;
  revision: number;
  snapshot: Notebook;
}

class LocalDb extends Dexie {
  notebooks!: EntityTable<LocalRow, 'id'>;
  constructor(owner: string) {
    super(`mn_notebooks_${owner}`);
    this.version(1).stores({ notebooks: 'id, updated_at' });
  }
}

/** Device-local notebooks: dev bypass, or until the Supabase migration is applied. */
class LocalRepo implements NotebookRepository {
  readonly kind = 'local' as const;
  private db: LocalDb;
  constructor(ownerId: string) {
    this.db = new LocalDb(ownerId);
  }

  async list() {
    const rows = await this.db.notebooks.orderBy('updated_at').reverse().toArray();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      updated_at: r.updated_at,
      revision: r.revision,
      mode: r.snapshot.mode,
      demo: !!(r.snapshot.extensions as { demo?: unknown } | undefined)?.demo,
      preview: previewOf(r.snapshot),
    }));
  }

  async load(id: string) {
    const row = await this.db.notebooks.get(id);
    return row ? { notebook: normalizeOpened(validate(row.snapshot)), revision: row.revision } : null;
  }

  async save(nb: Notebook, expectedRevision: number | null): Promise<SaveResult> {
    const snapshot = validate(nb);
    return this.db.transaction('rw', this.db.notebooks, async () => {
      const row = await this.db.notebooks.get(nb.id);
      if ((row?.revision ?? null) !== expectedRevision) return { ok: false as const, reason: 'conflict' as const };
      const revision = (expectedRevision ?? 0) + 1;
      await this.db.notebooks.put({ id: nb.id, title: nb.title, updated_at: new Date().toISOString(), revision, snapshot });
      return { ok: true as const, revision };
    });
  }

  async remove(id: string) {
    await this.db.notebooks.delete(id);
  }
}

const cache = new Map<string, NotebookRepository>();
let cloudUnavailable = false;

export function isCloudUnavailable() {
  return cloudUnavailable;
}

/** Cloud when signed in with Supabase; falls back to this device if the table is missing. */
export function getRepository(ownerId: string): NotebookRepository {
  const key = `${ownerId}:${DEV_BYPASS || cloudUnavailable ? 'local' : 'cloud'}`;
  let repo = cache.get(key);
  if (!repo) {
    repo = DEV_BYPASS || cloudUnavailable ? new LocalRepo(ownerId) : withFallback(new SupabaseRepo(ownerId), ownerId);
    cache.set(key, repo);
  }
  return repo;
}

function withFallback(cloud: SupabaseRepo, ownerId: string): NotebookRepository {
  const local = new LocalRepo(ownerId);
  const run = async <T>(fn: (r: NotebookRepository) => Promise<T>): Promise<T> => {
    if (cloudUnavailable) return fn(local);
    try {
      return await fn(cloud);
    } catch (e) {
      if (e instanceof RepoError && e.code === 'MIGRATION_MISSING') {
        cloudUnavailable = true;
        console.warn('[repo] mn_notebooks table missing; saving on this device until the migration is applied');
        return fn(local);
      }
      throw e;
    }
  };
  return {
    get kind() {
      return cloudUnavailable ? ('local' as const) : ('cloud' as const);
    },
    list: () => run((r) => r.list()),
    load: (id) => run((r) => r.load(id)),
    save: (nb, rev) => run((r) => r.save(nb, rev)),
    remove: (id) => run((r) => r.remove(id)),
  };
}

export async function deleteLocalNotebooks(ownerId: string) {
  await Dexie.delete(`mn_notebooks_${ownerId}`);
}
