import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Line, Notebook } from '@mn/contracts';
import { Autosaver, type AutosaveState } from '../../src/core/persistence/autosave';
import { openNotebook, pushAllPending, type PendingEdit, type PushDeps } from '../../src/core/persistence/outbox';
import type { SaveResult } from '../../src/core/persistence/repo';

const ID = '33333333-3333-4333-8333-333333333333';
const line = (state: Line['state']): Line =>
  ({ id: 'L1', version: 2, source: 'user', role: 'step', state, ink: [{ id: 's1', points: [{ x: 1, y: 2, t: 0, p: 0.5 }] }], segments: [] }) as unknown as Line;
const notebook = (title: string, lines: Line[] = []): Notebook =>
  ({
    schema_version: '2.2.0',
    id: ID,
    title,
    mode: 'live',
    domain: 'Reals',
    lines,
    recoveries: [],
  }) as unknown as Notebook;

const tick = () => new Promise((r) => setTimeout(r, 1));
const copyTitle = (t: string) => `${t} (copy)`;

/** An in-memory cloud with the repository's revision check, plus an outbox. */
function world(cloud: Notebook, revision: number, pending?: PendingEdit) {
  const rows = new Map<string, { notebook: Notebook; revision: number }>([[cloud.id, { notebook: cloud, revision }]]);
  const outbox = new Map<string, PendingEdit>(pending ? [[pending.notebook_id, pending]] : []);
  const deps: PushDeps = {
    repo: {
      async load(id) {
        await tick();
        const r = rows.get(id);
        return r ? { ...r } : null;
      },
      async save(nb, expected): Promise<SaveResult> {
        await tick();
        if ((rows.get(nb.id)?.revision ?? null) !== expected) return { ok: false, reason: 'conflict' };
        const revision = (expected ?? 0) + 1;
        rows.set(nb.id, { notebook: nb, revision });
        return { ok: true, revision };
      },
    },
    list: async () => [...outbox.values()],
    get: async (id) => outbox.get(id),
    clear: async (id) => void outbox.delete(id),
  };
  return { rows, outbox, deps };
}

const entry = (nb: Notebook, base: number | null): PendingEdit => ({ notebook_id: nb.id, snapshot: nb, base_revision: base, saved_at: '' });

describe('outbox push', () => {
  it('pushes one entry once, however many pushes start together', async () => {
    const edited = notebook('T', [line('RECOGNIZING')]);
    const w = world(notebook('T'), 3, entry(edited, 3));
    // home page effect re-running (StrictMode, auth events) and a sign-out sync at the same moment
    const runs = await Promise.all([1, 2, 3].map(() => pushAllPending('owner-a', copyTitle, new Set(), w.deps)));
    assert.equal(w.rows.size, 1, 'no copies');
    assert.equal(w.rows.get(ID)!.revision, 4);
    assert.equal(w.outbox.size, 0);
    assert.deepEqual(runs.flat().map((r) => r.kind), ['saved']);
  });

  it('keeps no copy when the conflicting save was these very edits', async () => {
    const edited = notebook('T', [line('RECOGNIZING')]);
    const w = world(notebook('T'), 3, entry(edited, 3));
    const save = w.deps.repo.save;
    // another writer lands the same edits between our load and our save
    w.deps.repo.save = async (nb, expected) => {
      w.rows.set(ID, { notebook: edited, revision: 4 });
      w.deps.repo.save = save;
      return save(nb, expected);
    };
    const out = await pushAllPending('owner-b', copyTitle, new Set(), w.deps);
    assert.deepEqual(out.map((r) => r.kind), ['unchanged']);
    assert.equal(w.rows.size, 1);
    assert.equal(w.outbox.size, 0);
  });

  it('still keeps edits made against an older revision as a copy', async () => {
    const w = world(notebook('cloud'), 5, entry(notebook('device'), 3));
    const out = await pushAllPending('owner-c', copyTitle, new Set(), w.deps);
    assert.deepEqual(out.map((r) => r.kind), ['copied']);
    assert.equal(w.rows.size, 2);
    assert.equal(w.rows.get(ID)!.notebook.title, 'cloud', 'the cloud version is not overwritten');
  });

  it('waits for a notebook that is closing before reconciling it', async () => {
    const edited = notebook('T', [line('RECOGNIZING')]);
    const w = world(notebook('T'), 3);
    const state: AutosaveState = { notebook: edited, dirty: true, cloudRevision: 3 };
    const saver = new Autosaver({
      getState: () => state,
      subscribe: () => () => undefined,
      saveCloud: (nb, rev) => w.deps.repo.save(nb, rev),
      saveLocal: async (nb, rev) => void w.outbox.set(nb.id, entry(nb, rev)),
      clearLocal: (id) => w.deps.clear(id),
      onSaved: () => undefined,
      onStatus: () => undefined,
    });
    saver.start();
    // leave the notebook mid-recognition and land on the home page at once
    void saver.close();
    const out = await pushAllPending('owner-d', copyTitle, new Set(), w.deps);
    assert.deepEqual(out, [], 'the closing save sent the edits; nothing was left to push');
    assert.equal(w.rows.size, 1, 'no copies');
    assert.equal(w.rows.get(ID)!.revision, 4);
    assert.equal(w.outbox.size, 0);
  });

  it('serializes opening with a push of the same notebook', async () => {
    const edited = notebook('T', [line('RECOGNIZING')]);
    const w = world(notebook('T'), 3, entry(edited, 3));
    const [pushed, opened] = await Promise.all([pushAllPending('owner-e', copyTitle, new Set(), w.deps), openNotebook('owner-e', ID, copyTitle, w.deps)]);
    assert.deepEqual(pushed.map((r) => r.kind), ['saved']);
    assert.equal(opened?.revision, 4, 'opens what the push just saved');
    assert.equal(opened?.recoveredCopy, undefined);
    assert.equal(w.rows.size, 1);
  });
});

describe('autosave close', () => {
  it('rebases the device copy when a save lands while closing', async () => {
    let state: AutosaveState = { notebook: notebook('a'), dirty: true, cloudRevision: 1 };
    const listeners = new Set<(s: AutosaveState, p: AutosaveState) => void>();
    const local: { title: string; rev: number | null }[] = [];
    let release!: () => void;
    let calls = 0;
    const saver = new Autosaver({
      getState: () => state,
      subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
      saveCloud: async () => {
        calls += 1;
        // the first save hangs until released; the second one fails (offline)
        if (calls === 1) await new Promise<void>((r) => (release = r));
        return calls === 1 ? { ok: true, revision: 2 } : { ok: false, reason: 'network' };
      },
      saveLocal: async (nb, rev) => void local.push({ title: nb.title, rev }),
      clearLocal: async () => undefined,
      onSaved: () => undefined,
      onStatus: () => undefined,
    });
    saver.start();
    void saver.flush();
    await tick();
    // the recognition result arrives while the first save is in flight, then the user leaves
    const prev = state;
    state = { ...state, notebook: notebook('b') };
    for (const l of listeners) l(state, prev);
    const closed = saver.close();
    release();
    assert.equal(await closed, false, 'the second save failed: the edits stay in the outbox');
    assert.deepEqual(local.at(-1), { title: 'b', rev: 2 }, 'based on the revision the cloud is at, not the one before the save');
  });
});
