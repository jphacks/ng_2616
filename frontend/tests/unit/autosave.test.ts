import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Line, Notebook, Stroke } from '@mn/contracts';
import { Autosaver, TIMING, type AutosaveState, type SyncState } from '../../src/core/persistence/autosave';
import { inkHash, joinInk, splitInk } from '../../src/core/persistence/ink';
import type { SaveResult } from '../../src/core/persistence/repo';

const stroke = (id: string, n = 3): Stroke => ({ id, points: Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2, t: i * 10, p: 0.5 })) });
const line = (id: string, ink: Stroke[] = []): Line => ({ id, version: 1, source: 'user', role: 'step', state: 'DRAFT', ink, segments: [] });
const notebook = (lines: Line[], title = 'T'): Notebook =>
  ({
    schema_version: '2.2.0',
    id: '33333333-3333-4333-8333-333333333333',
    title,
    mode: 'live',
    domain: 'Reals',
    lines,
    recoveries: [],
  }) as unknown as Notebook;

describe('ink split', () => {
  it('moves ink out of the snapshot by content hash and puts it back', () => {
    const a = [stroke('s1'), stroke('s2')];
    const nb = notebook([line('L1', a), line('L2'), line('L3', a)]);
    const { snapshot, index, inks } = splitInk(nb);
    assert.ok(snapshot.lines.every((l) => l.ink.length === 0));
    assert.deepEqual(Object.keys(index), ['L1', 'L3'], 'lines without ink are not indexed');
    assert.equal(index.L1, index.L3, 'identical ink shares one row');
    assert.equal(inks.size, 1);
    assert.deepEqual(joinInk(snapshot, index, inks), nb);
  });

  it('hashes by content, not by array identity', () => {
    assert.equal(inkHash([stroke('s1')]), inkHash([stroke('s1')]));
    assert.notEqual(inkHash([stroke('s1')]), inkHash([stroke('s1', 4)]));
  });

  it('opens a line whose ink is missing with an empty drawing', () => {
    const nb = notebook([line('L1', [stroke('s1')])]);
    const { snapshot, index } = splitInk(nb);
    assert.deepEqual(joinInk(snapshot, index, new Map()).lines[0]!.ink, []);
  });
});

/** Manual clock: `advance` runs due timers in order. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        seq += 1;
        queue.set(seq, { at: now + ms, fn });
        return seq;
      },
      clear: (t: unknown) => void queue.delete(t as number),
      now: () => now,
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function harness(saveCloud: (nb: Notebook, rev: number | null) => Promise<SaveResult>) {
  const clock = fakeTimers();
  let state: AutosaveState = { notebook: notebook([]), dirty: false, cloudRevision: 1 };
  const listeners = new Set<(s: AutosaveState, p: AutosaveState) => void>();
  const log = { cloud: [] as { title: string; rev: number | null }[], local: [] as { title: string; rev: number | null }[], now: [] as { title: string; rev: number | null }[], cleared: 0, statuses: [] as SyncState[] };
  const saver = new Autosaver({
    getState: () => state,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    saveCloud: async (nb, rev) => {
      log.cloud.push({ title: nb.title, rev });
      return saveCloud(nb, rev);
    },
    saveLocal: async (nb, rev) => void log.local.push({ title: nb.title, rev }),
    saveLocalNow: (nb, rev) => (log.now.push({ title: nb.title, rev }), true),
    clearLocal: async () => void (log.cleared += 1),
    onSaved: (nb, rev) => {
      state = { ...state, cloudRevision: rev, dirty: state.notebook !== nb };
    },
    onStatus: (s) => void log.statuses.push(s),
    timers: clock.timers,
  });
  const edit = (title: string) => {
    const prev = state;
    state = { ...state, notebook: notebook([], title), dirty: true };
    for (const l of listeners) l(state, prev);
  };
  saver.start();
  return { saver, clock, edit, log, get state() {
    return state;
  } };
}

let rev = 1;
const okSave = async (): Promise<SaveResult> => ({ ok: true, revision: ++rev });

describe('autosave', () => {
  it('debounces: one device write after 1 s and one cloud save after 3 s of quiet', async () => {
    rev = 1;
    const h = harness(okSave);
    h.edit('a');
    await h.clock.advance(500);
    h.edit('b');
    await h.clock.advance(TIMING.localDebounce);
    assert.deepEqual(h.log.local, [{ title: 'b', rev: 1 }]);
    assert.equal(h.log.cloud.length, 0);
    await h.clock.advance(TIMING.cloudDebounce);
    assert.deepEqual(h.log.cloud, [{ title: 'b', rev: 1 }]);
    assert.equal(h.state.dirty, false);
    assert.equal(h.log.cleared, 1, 'the outbox entry is dropped once the cloud has it');
    assert.equal(h.log.statuses.at(-1), 'saved');
  });

  it('saves to the cloud at least every 15 s while editing continuously', async () => {
    rev = 1;
    const h = harness(okSave);
    for (let t = 0; t < 16_000; t += 1000) {
      h.edit(`e${t}`);
      await h.clock.advance(1000);
    }
    assert.equal(h.log.cloud.length, 1, 'the max wait forced one save');
    assert.ok(h.log.local.length >= 3, 'device writes happen at least every 5 s');
  });

  it('sends edits made during a save right after, against the new revision', async () => {
    rev = 1;
    let release!: () => void;
    const h = harness(
      (_nb, r) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, revision: (r ?? 0) + 1 });
        }),
    );
    h.edit('a');
    await h.clock.advance(TIMING.cloudDebounce);
    h.edit('b');
    release();
    await h.clock.advance(0);
    assert.equal(h.state.dirty, true, 'edits from during the save stay unsent');
    await h.clock.advance(TIMING.localDebounce);
    release();
    await h.clock.advance(0);
    assert.deepEqual(h.log.cloud, [{ title: 'a', rev: 1 }, { title: 'b', rev: 2 }]);
    assert.equal(h.state.dirty, false);
  });

  it('backs off on network errors and recovers', async () => {
    let fail = 2;
    const h = harness(async (_nb, r) => (fail-- > 0 ? { ok: false, reason: 'network' } : { ok: true, revision: (r ?? 0) + 1 }));
    h.edit('a');
    await h.clock.advance(TIMING.cloudDebounce);
    assert.equal(h.log.statuses.at(-1), 'offline');
    await h.clock.advance(TIMING.retryMin - 1);
    assert.equal(h.log.cloud.length, 1, 'no retry before the backoff');
    await h.clock.advance(1);
    assert.equal(h.log.cloud.length, 2);
    await h.clock.advance(TIMING.retryMin * 2);
    assert.equal(h.log.cloud.length, 3);
    assert.equal(h.log.statuses.at(-1), 'saved');
  });

  it('stops on a conflict until reset, keeping the device copy', async () => {
    const h = harness(async () => ({ ok: false, reason: 'conflict' }));
    h.edit('a');
    await h.clock.advance(TIMING.cloudDebounce);
    assert.equal(h.log.statuses.at(-1), 'conflict');
    h.edit('b');
    await h.clock.advance(60_000);
    assert.equal(h.log.cloud.length, 1, 'no further cloud saves');
    assert.equal(h.log.local.at(-1)?.title, 'b', 'the outbox still records new edits');
    assert.equal(h.saver.hasUnsent, true);
  });

  it('flush writes immediately and reports whether the cloud is current', async () => {
    rev = 1;
    const h = harness(okSave);
    assert.equal(await h.saver.flush(), true, 'nothing to send');
    h.edit('a');
    const done = h.saver.flush();
    await h.clock.advance(0);
    assert.equal(await done, true);
    assert.deepEqual(h.log.local, [{ title: 'a', rev: 1 }]);
    assert.deepEqual(h.log.cloud, [{ title: 'a', rev: 1 }]);
  });

  it('writes the outbox synchronously when the page goes away, once per state', async () => {
    rev = 1;
    const h = harness(okSave);
    h.edit('a');
    h.saver.flushLocal();
    assert.deepEqual(h.log.now, [{ title: 'a', rev: 1 }], 'written before any timer or promise runs');
    h.saver.flushLocal();
    assert.equal(h.log.now.length, 1, 'nothing new to write');
    await h.clock.advance(TIMING.localDebounce);
    assert.equal(h.log.local.length, 0, 'the debounced write was replaced by the immediate one');
  });

  it('flush after stop still sends the last edit (leaving the notebook)', async () => {
    rev = 1;
    const h = harness(okSave);
    h.edit('a');
    const done = h.saver.flush();
    h.saver.stop();
    await h.clock.advance(0);
    assert.equal(await done, true);
    assert.equal(h.log.cloud.length, 1);
  });
});
