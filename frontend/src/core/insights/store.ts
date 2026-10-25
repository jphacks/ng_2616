'use client';

import { NotebookSchema, NotebookStatsSchema, normalizeTags, type Notebook, type NotebookStats } from '@mn/contracts';
import Dexie, { type EntityTable } from 'dexie';
import { api } from '@/core/api/client';
import { DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { uuid } from '@/core/ids';
import { currentLocale } from '@/i18n';
import { localDay, notebookStats, shouldRetag, tagKey, tagLines, tagText, withDay, type TagState } from './stats';

/**
 * Notebook insights (`mn_notebook_insights`, migration 0003): counts recorded at every save, the
 * days the notebook was saved on, and three subject tags the model reads from the content now
 * and then. The home page's progress section draws them; the notebook itself never shows them.
 */
export interface NotebookInsight {
  notebook_id: string;
  tags: string[];
  stats: NotebookStats | null;
  active_days: string[];
}

type Row = NotebookInsight & TagState;

interface Backend {
  all(): Promise<Row[]>;
  put(row: Row): Promise<void>;
  /** the notebook without its ink, enough to count from */
  snapshot(id: string): Promise<Notebook | null>;
}

const COLUMNS = 'notebook_id,tags,stats,active_days,tags_hash,tags_lines,tagged_at';

/** The table is missing until migration 0003 is applied: insights then stay off for the session. */
class MissingTable extends Error {}

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === 'PGRST205' || error.code === '42P01' || /mn_notebook_insights/.test(error.message ?? '')) throw new MissingTable(error.message);
  throw new Error(error.message ?? 'request failed');
}

function parseRow(r: Record<string, unknown>): Row {
  const stats = NotebookStatsSchema.safeParse(r.stats);
  return {
    notebook_id: r.notebook_id as string,
    tags: normalizeTags((r.tags as string[] | null) ?? []),
    stats: stats.success ? stats.data : null,
    active_days: ((r.active_days as string[] | null) ?? []).slice().sort(),
    tags_hash: (r.tags_hash as string | null) ?? null,
    tags_lines: (r.tags_lines as number | null) ?? 0,
    tagged_at: (r.tagged_at as string | null) ?? null,
  };
}

const cloud = (ownerId: string): Backend => ({
  async all() {
    const { data, error } = await supabaseBrowser().from('mn_notebook_insights').select(COLUMNS).limit(500);
    check(error);
    return ((data ?? []) as Record<string, unknown>[]).map(parseRow);
  },
  async put(row) {
    const { error } = await supabaseBrowser()
      .from('mn_notebook_insights')
      .upsert({ ...row, owner_id: ownerId }, { onConflict: 'notebook_id' });
    check(error);
  },
  async snapshot(id) {
    const { data, error } = await supabaseBrowser().from('mn_notebooks').select('snapshot').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    const nb = data ? NotebookSchema.safeParse(data.snapshot) : null;
    return nb?.success ? nb.data : null;
  },
});

class LocalInsightsDb extends Dexie {
  insights!: EntityTable<Row, 'notebook_id'>;
  constructor(owner: string) {
    super(`mn_insights_${owner}`);
    this.version(1).stores({ insights: 'notebook_id' });
  }
}

/** The dev bypass keeps insights on the device, next to its notebooks. */
function local(ownerId: string): Backend {
  const db = new LocalInsightsDb(ownerId);
  return {
    all: () => db.insights.toArray(),
    put: async (row) => void (await db.insights.put(row)),
    async snapshot(id) {
      const { getRepository } = await import('@/core/persistence/repo');
      return (await getRepository(ownerId).load(id))?.notebook ?? null;
    },
  };
}

const empty = (id: string): Row => ({ notebook_id: id, tags: [], stats: null, active_days: [], tags_hash: null, tags_lines: 0, tagged_at: null });

/** After a failed or mock tag call, the notebook's next saves wait this long before asking again. */
const TAG_RETRY_MS = 5 * 60 * 1000;
/** Notebooks saved before insights existed are counted from the home page, a few per visit. */
const BACKFILL_PER_VISIT = 30;
const KNOWN_TAGS_SENT = 80;
const sessionId = uuid();

class Recorder {
  private rows: Promise<Map<string, Row>> | null = null;
  private off = false;
  private pending = new Map<string, { nb: Notebook; day: string }>();
  private draining = new Set<string>();
  /** one tag call at a time: the gateway allows only a few unfinished requests per student */
  private tagging: Promise<unknown> = Promise.resolve();
  private tagFailedAt = new Map<string, number>();
  private model: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();

  constructor(private backend: Backend) {}

  private load(): Promise<Map<string, Row>> {
    this.rows ??= this.backend.all().then(
      (rows) => new Map(rows.map((r) => [r.notebook_id, r])),
      (e: unknown) => {
        this.rows = null;
        throw e;
      },
    );
    return this.rows;
  }

  async all(): Promise<NotebookInsight[]> {
    if (this.off) return [];
    try {
      return [...(await this.load()).values()];
    } catch (e) {
      this.fail(e);
      return [];
    }
  }

  /** Reads every row again (another device may have saved since). */
  refresh(): Promise<NotebookInsight[]> {
    if (!this.draining.size) this.rows = null;
    return this.all();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Records a saved notebook; saves that arrive while one is being recorded collapse into the last. */
  record(nb: Notebook, day = localDay(new Date())) {
    if (this.off) return;
    this.pending.set(nb.id, { nb, day });
    if (!this.draining.has(nb.id)) void this.drain(nb.id);
  }

  /** Counts notebooks that have no insights yet, oldest work first, without opening them. */
  async backfill(notebooks: readonly { id: string; updated_at: string }[]) {
    if (this.off) return;
    let rows: Map<string, Row>;
    try {
      rows = await this.load();
    } catch (e) {
      return this.fail(e);
    }
    const missing = notebooks.filter((n) => !rows.has(n.id)).slice(0, BACKFILL_PER_VISIT);
    for (const n of missing) {
      const nb = await this.backend.snapshot(n.id).catch(() => null);
      if (this.off) return;
      if (nb) this.record(nb, localDay(new Date(n.updated_at)));
    }
  }

  private async drain(id: string) {
    this.draining.add(id);
    try {
      for (let next = this.pending.get(id); next; next = this.pending.get(id)) {
        this.pending.delete(id);
        await this.recordOne(next.nb, next.day).catch((e: unknown) => this.fail(e));
        if (this.off) return;
      }
    } finally {
      this.draining.delete(id);
    }
  }

  private async recordOne(nb: Notebook, day: string) {
    const rows = await this.load();
    const prev = rows.get(nb.id) ?? empty(nb.id);
    const counted: Row = { ...prev, stats: notebookStats(nb), active_days: withDay(prev.active_days, day) };
    if (JSON.stringify(counted) !== JSON.stringify(prev)) await this.write(rows, counted);
    const key = tagKey(nb);
    const lines = tagLines(nb);
    const now = Date.now();
    if (!shouldRetag(counted, key, lines, now) || now - (this.tagFailedAt.get(nb.id) ?? 0) < TAG_RETRY_MS) return;
    if (!(await this.hasModel())) return;
    const tags = await this.readTags(nb, rows, key);
    if (!tags) {
      this.tagFailedAt.set(nb.id, Date.now());
      return;
    }
    this.tagFailedAt.delete(nb.id);
    // a newer save may have written counts meanwhile: tag that row
    const latest = rows.get(nb.id) ?? counted;
    await this.write(rows, { ...latest, tags, tags_hash: key, tags_lines: lines, tagged_at: new Date().toISOString() });
  }

  private async write(rows: Map<string, Row>, row: Row) {
    await this.backend.put(row);
    rows.set(row.notebook_id, row);
    for (const fn of this.listeners) fn();
  }

  /** Whether the server has a real model: a mock one reads no tags, so none are asked for. */
  private hasModel(): Promise<boolean> {
    this.model ??= api.capabilities().then(
      (c) => !c.llm.mock,
      () => {
        // unknown (offline): ask again on a later save
        this.model = null;
        return false;
      },
    );
    return this.model;
  }

  private readTags(nb: Notebook, rows: Map<string, Row>, key: string): Promise<string[] | null> {
    const call = this.tagging.then(async () => {
      const result = await api.tag(
        { request_id: uuid(), notebook_id: nb.id, client_session_id: sessionId, client_epoch: 0, context_fingerprint: key as `sha256:${string}` },
        { title: nb.title, text: tagText(nb), known_tags: knownTags(rows, nb.id), ui_lang: currentLocale() },
      );
      // the mock provider reads nothing: keep the notebook untagged so a real model reads it later
      return result.mock ? null : normalizeTags(result.tags);
    });
    this.tagging = call.catch(() => undefined);
    return call.catch((e: unknown) => {
      console.warn('[insights] tags not read', e instanceof Error ? e.message : e);
      return null;
    });
  }

  private fail(e: unknown) {
    if (e instanceof MissingTable) {
      // logged once: every later save would hit the same missing table
      if (!this.off) console.warn('[insights] off until migration 0003 is applied:', e.message);
      this.off = true;
      this.pending.clear();
      return;
    }
    console.warn('[insights] not recorded', e instanceof Error ? e.message : e);
  }
}

/** The student's tags across other notebooks, most used first, so the model reuses their spelling. */
function knownTags(rows: ReadonlyMap<string, Row>, except: string): string[] {
  const count = new Map<string, number>();
  for (const r of rows.values()) if (r.notebook_id !== except) for (const t of r.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, KNOWN_TAGS_SENT).map(([t]) => t);
}

const recorders = new Map<string, Recorder>();

export function insightsFor(ownerId: string): Recorder {
  let r = recorders.get(ownerId);
  if (!r) {
    r = new Recorder(DEV_BYPASS ? local(ownerId) : cloud(ownerId));
    recorders.set(ownerId, r);
  }
  return r;
}

/** Called after every successful save; never delays or fails the save itself. */
export function recordInsights(ownerId: string, nb: Notebook) {
  try {
    insightsFor(ownerId).record(nb);
  } catch (e) {
    console.warn('[insights] not recorded', e instanceof Error ? e.message : e);
  }
}
