'use client';

import { NotebookSchema, type Notebook, type Stroke } from '@mn/contracts';
import Dexie, { type EntityTable } from 'dexie';
import { DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { uuid } from '@/core/ids';
import { buildPreview, previewOf, PREVIEW_LINES, type NotebookPreview } from '@/core/notebook/preview';
import { removeNotebookResources } from '@/core/resources/service';
import { inkHash, joinInk, splitInk } from './ink';

export interface NotebookSummary {
  id: string;
  title: string;
  updated_at: string;
  revision: number;
  mode?: string;
  demo?: boolean;
  preview?: NotebookPreview;
}

// Rows saved since ADR 0005 carry a `preview` column; older rows are previewed from a few
// leading snapshot lines (superseded ones are skipped) instead of the whole snapshot.
const LEGACY_PREVIEW_COLUMNS = Array.from({ length: PREVIEW_LINES + 2 }, (_, i) => `l${i}:snapshot->lines->${i}`).join(',');
// a plain string: the column list is built at runtime, so the typed select parser cannot read it
const LIST_COLUMNS: string = `id,title,updated_at,revision,mode:snapshot->>mode,demo:snapshot->extensions->demo->>script,preview,${LEGACY_PREVIEW_COLUMNS}`;

export type SaveFailure = 'conflict' | 'too_large' | 'auth' | 'network' | 'error';
export type SaveResult = { ok: true; revision: number } | { ok: false; reason: SaveFailure; message?: string };

export interface NotebookRepository {
  readonly kind: 'cloud' | 'local';
  list(): Promise<NotebookSummary[]>;
  load(id: string): Promise<{ notebook: Notebook; revision: number } | null>;
  /** Insert (expectedRevision null) or update by id + expected revision; a moved revision = conflict. */
  save(nb: Notebook, expectedRevision: number | null): Promise<SaveResult>;
  /** Deletes the notebook with its resources and their files. */
  remove(id: string): Promise<void>;
}

export class RepoError extends Error {
  constructor(public code: 'MIGRATION_MISSING' | 'SNAPSHOT_INVALID' | 'AUTH' | 'NETWORK', message: string) {
    super(message);
  }
}

const MAX_SNAPSHOT = 8 * 1024 * 1024;
const MAX_PREVIEW = 900 * 1024;
const INK_PAGE = 500;

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

type PgError = { code?: string; message?: string } | null;

function migrationMissing(e: PgError): boolean {
  if (!e) return false;
  // PGRST202: function not found, PGRST204/205: column/table not in the schema cache
  if (e.code === 'PGRST202' || e.code === 'PGRST204' || e.code === 'PGRST205' || e.code === '42P01' || e.code === '42883') return true;
  const m = e.message ?? '';
  return /mn_notebooks|mn_save_notebook|ink_index|preview/.test(m) && /not find|does not exist/.test(m);
}

function failure(e: NonNullable<PgError>): SaveFailure {
  if (e.code === 'PT409' || e.code === '23505') return 'conflict';
  if (e.code === 'PT413' || e.code === '23514') return 'too_large';
  if (e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt/i.test(e.message ?? '')) return 'auth';
  if (!e.code && /fetch|network|load failed/i.test(e.message ?? '')) return 'network';
  return 'error';
}

function thrown(e: NonNullable<PgError>): RepoError {
  if (migrationMissing(e)) return new RepoError('MIGRATION_MISSING', e.message ?? 'database migration missing');
  const f = failure(e);
  return new RepoError(f === 'auth' ? 'AUTH' : 'NETWORK', e.message ?? 'request failed');
}

/** The card preview, without ink when a few long lines would make it heavy. */
function previewFor(nb: Notebook): NotebookPreview {
  const p = previewOf(nb);
  if (JSON.stringify(p).length <= MAX_PREVIEW) return p;
  return { ...p, lines: p.lines.map((l) => ({ ...l, ink: [] })) };
}

class SupabaseRepo implements NotebookRepository {
  readonly kind = 'cloud' as const;
  /** ink hashes the server is known to hold, per notebook, so a save sends only new strokes */
  private known = new Map<string, Set<string>>();

  constructor(private ownerId: string) {}

  private get db() {
    return supabaseBrowser();
  }

  async list() {
    const { data, error } = await this.db
      .from('mn_notebooks')
      .select(LIST_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw thrown(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      updated_at: r.updated_at as string,
      revision: r.revision as number,
      mode: (r.mode as string | null) ?? undefined,
      demo: !!r.demo,
      preview: (r.preview as NotebookPreview | null) ?? buildPreview(
        Array.from({ length: PREVIEW_LINES + 2 }, (_, i) => r[`l${i}`]).filter((l) => l != null),
      ),
    }));
  }

  async load(id: string) {
    const { data, error } = await this.db.from('mn_notebooks').select('snapshot,revision,ink_index').eq('id', id).maybeSingle();
    if (error) throw thrown(error);
    if (!data) return null;
    const index = data.ink_index as Record<string, string> | null;
    // legacy rows (before ADR 0005) still carry their ink inline
    if (!index) {
      this.known.set(id, new Set());
      return { notebook: normalizeOpened(validate(data.snapshot)), revision: data.revision as number };
    }
    const inks = await this.fetchInk(id);
    this.known.set(id, new Set(inks.keys()));
    return { notebook: normalizeOpened(validate(joinInk(data.snapshot as Notebook, index, inks))), revision: data.revision as number };
  }

  private async fetchInk(id: string): Promise<Map<string, Stroke[]>> {
    const inks = new Map<string, Stroke[]>();
    for (let from = 0; ; from += INK_PAGE) {
      const { data, error } = await this.db
        .from('mn_notebook_ink')
        .select('hash,strokes')
        .eq('notebook_id', id)
        .order('hash')
        .range(from, from + INK_PAGE - 1);
      if (error) throw thrown(error);
      for (const r of data ?? []) inks.set(r.hash as string, r.strokes as Stroke[]);
      if (!data || data.length < INK_PAGE) return inks;
    }
  }

  async save(nb: Notebook, expectedRevision: number | null): Promise<SaveResult> {
    const full = validate(nb);
    const { snapshot, index, inks } = splitInk(full);
    if (JSON.stringify(snapshot).length > MAX_SNAPSHOT) return { ok: false, reason: 'too_large' };
    const preview = previewFor(full);
    const attempt = async (known: Set<string>) => {
      const fresh = [...inks].filter(([h]) => !known.has(h)).map(([hash, strokes]) => ({ hash, strokes }));
      return this.db.rpc('mn_save_notebook', {
        p_id: nb.id,
        p_expected_revision: expectedRevision,
        p_title: nb.title,
        p_snapshot: snapshot,
        p_preview: preview,
        p_ink_index: index,
        p_new_ink: fresh,
      });
    };
    let { data, error } = await attempt(expectedRevision === null ? new Set() : (this.known.get(nb.id) ?? new Set()));
    // the server dropped ink we thought it had (saved elsewhere meanwhile): send everything once
    if (error?.code === 'PT422') ({ data, error } = await attempt(new Set()));
    if (error) {
      if (migrationMissing(error)) throw new RepoError('MIGRATION_MISSING', error.message);
      return { ok: false, reason: failure(error), message: error.message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { revision: number } | undefined;
    if (!row) return { ok: false, reason: 'error', message: 'empty save response' };
    this.known.set(nb.id, new Set(Object.values(index)));
    return { ok: true, revision: Number(row.revision) };
  }

  async remove(id: string) {
    await removeNotebookResources(this.ownerId, id);
    const { error } = await this.db.from('mn_notebooks').delete().eq('id', id);
    if (error) throw thrown(error);
    this.known.delete(id);
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

/** Device-only notebooks for the local dev bypass (no Supabase). */
class LocalRepo implements NotebookRepository {
  readonly kind = 'local' as const;
  private db: LocalDb;
  constructor(private ownerId: string) {
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
    await removeNotebookResources(this.ownerId, id);
    await this.db.notebooks.delete(id);
  }
}

const cache = new Map<string, NotebookRepository>();

/** True only for the local dev bypass: everything else is stored in Supabase (ADR 0005). */
export function isCloudUnavailable() {
  return DEV_BYPASS;
}

export function getRepository(ownerId: string): NotebookRepository {
  let repo = cache.get(ownerId);
  if (!repo) {
    repo = DEV_BYPASS ? new LocalRepo(ownerId) : new SupabaseRepo(ownerId);
    cache.set(ownerId, repo);
  }
  return repo;
}

const legacyDbName = (ownerId: string) => `mn_notebooks_${ownerId}`;

/**
 * One-time move of notebooks an older build kept on this device (before ADR 0005) into the
 * cloud. An id the cloud already holds with different content is kept as a copy. Returns how
 * many notebooks were uploaded; the device copy is deleted once all of them are in.
 */
export async function importDeviceNotebooks(ownerId: string, copyTitle: (title: string) => string): Promise<number> {
  if (DEV_BYPASS || !(await Dexie.exists(legacyDbName(ownerId)))) return 0;
  const local = new LocalDb(ownerId);
  const cloud = getRepository(ownerId);
  let moved = 0;
  try {
    for (const row of await local.notebooks.toArray()) {
      const nb = NotebookSchema.safeParse(row.snapshot);
      if (!nb.success) continue;
      let res = await cloud.save(nb.data, null);
      if (!res.ok && res.reason === 'conflict') {
        const existing = await cloud.load(nb.data.id);
        if (existing && sameContent(existing.notebook, nb.data)) res = { ok: true, revision: existing.revision };
        else res = await cloud.save({ ...nb.data, id: uuid(), title: copyTitle(nb.data.title).slice(0, 200) }, null);
      }
      if (!res.ok) return moved; // keep the device copy; retried on the next visit
      await local.notebooks.delete(row.id);
      moved += 1;
    }
  } finally {
    local.close();
  }
  await Dexie.delete(legacyDbName(ownerId));
  return moved;
}

function sameContent(a: Notebook, b: Notebook): boolean {
  return a.title === b.title && a.lines.length === b.lines.length && a.lines.every((l, i) => l.id === b.lines[i]!.id && l.version === b.lines[i]!.version && inkHash(l.ink) === inkHash(b.lines[i]!.ink));
}

export async function deleteLocalNotebooks(ownerId: string) {
  // the dev bypass keeps its notebooks only here
  if (!DEV_BYPASS) await Dexie.delete(legacyDbName(ownerId));
}
