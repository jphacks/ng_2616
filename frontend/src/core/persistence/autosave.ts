import type { Notebook } from '@mn/contracts';
import type { SaveResult } from './repo';

/** Spec §14.5: debounce device writes 1 s and cloud writes 3 s, but write at least every 5 s / 15 s. */
export const TIMING = { localDebounce: 1000, localMax: 5000, cloudDebounce: 3000, cloudMax: 15000, retryMin: 2000, retryMax: 60000 };

export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'auth' | 'error' | 'conflict';

export interface AutosaveState {
  notebook: Notebook | null;
  dirty: boolean;
  cloudRevision: number | null;
}

export interface AutosaveDeps {
  getState(): AutosaveState;
  subscribe(listener: (s: AutosaveState, prev: AutosaveState) => void): () => void;
  saveCloud(nb: Notebook, expectedRevision: number | null): Promise<SaveResult>;
  saveLocal(nb: Notebook, baseRevision: number | null): Promise<void>;
  /** the same write issued synchronously (page unloading); false when it could not start */
  saveLocalNow?(nb: Notebook, baseRevision: number | null): boolean;
  clearLocal(id: string): Promise<void>;
  /** the cloud now holds `nb` at `revision` */
  onSaved(nb: Notebook, revision: number): void;
  onStatus(state: SyncState, message?: string): void;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void; now: () => number };
}

const realTimers = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** A debounced timer that still fires `max` ms after the first unsaved change. */
class Deadline {
  private handle: unknown = null;
  private first: number | null = null;
  constructor(private timers: NonNullable<AutosaveDeps['timers']>, private debounce: number, private max: number, private run: () => void) {}

  poke() {
    const now = this.timers.now();
    this.first ??= now;
    this.at(Math.max(0, Math.min(now + this.debounce, this.first + this.max) - now));
  }

  at(ms: number) {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = this.timers.set(() => {
      this.handle = null;
      this.first = null;
      this.run();
    }, ms);
  }

  cancel() {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
    this.first = null;
  }

  get pending() {
    return this.handle !== null;
  }
}

const running = new Set<Autosaver>();

/** Sends every open notebook's unsent edits now; true when all reached the cloud. */
export async function flushOpenNotebooks(): Promise<boolean> {
  const results = await Promise.all([...running].map((s) => s.flush()));
  return results.every(Boolean);
}

/**
 * Saves the open notebook automatically: first to this device (the outbox), then to the cloud.
 * One cloud save at a time; edits made during a save are sent right after. Network, auth and
 * server failures retry with backoff; a conflict stops cloud saves until `reset()`.
 */
export class Autosaver {
  private timers: NonNullable<AutosaveDeps['timers']>;
  private local: Deadline;
  private cloud: Deadline;
  private unsub: (() => void) | null = null;
  private localChain: Promise<void> = Promise.resolve();
  private inFlight: Promise<void> | null = null;
  /** newest edited state not yet in the cloud, and the revision the cloud is at */
  private latest: Notebook | null = null;
  /** newest state already handed to the device outbox */
  private written: Notebook | null = null;
  private revision: number | null;
  private failures = 0;
  private lastFailure: SyncState = 'error';
  private paused = false;
  private stopped = false;

  constructor(private deps: AutosaveDeps) {
    this.timers = deps.timers ?? realTimers;
    this.revision = deps.getState().cloudRevision;
    this.local = new Deadline(this.timers, TIMING.localDebounce, TIMING.localMax, () => void this.writeLocal());
    this.cloud = new Deadline(this.timers, TIMING.cloudDebounce, TIMING.cloudMax, () => void this.writeCloud());
  }

  start() {
    running.add(this);
    this.unsub = this.deps.subscribe((s, prev) => {
      if (!s.notebook || !s.dirty) return;
      if (s.notebook === prev.notebook && prev.dirty) return;
      this.changed(s.notebook);
    });
    const s = this.deps.getState();
    if (s.notebook && s.dirty) this.changed(s.notebook);
  }

  /** Stops scheduling; anything unsent stays in the outbox and goes out on the next open. */
  stop() {
    this.stopped = true;
    running.delete(this);
    this.unsub?.();
    this.local.cancel();
    this.cloud.cancel();
  }

  /** After a reload or "save as copy" replaced the open notebook: resume normal saving. */
  reset() {
    this.paused = false;
    this.failures = 0;
    this.local.cancel();
    this.cloud.cancel();
    const s = this.deps.getState();
    this.revision = s.cloudRevision;
    this.latest = null;
    if (s.notebook && s.dirty) this.changed(s.notebook);
    else this.deps.onStatus('idle');
  }

  /** Retry now (back online, signed in again, or the user asked). */
  retry() {
    if (!this.stopped && !this.paused && this.latest) this.cloud.at(0);
  }

  /** Edits the cloud does not have yet. */
  get hasUnsent() {
    return this.latest !== null;
  }

  /** Writes the current state everywhere now; true when the cloud holds it. */
  async flush(): Promise<boolean> {
    const target = this.latest;
    if (!target) return true;
    this.local.cancel();
    await this.writeLocal();
    if (this.inFlight) await this.inFlight;
    if (!this.paused && this.latest) {
      this.cloud.cancel();
      await this.writeCloud();
    }
    return this.latest === null;
  }

  /** The page is going away: write the outbox synchronously, the only write likely to finish. */
  flushLocal() {
    const nb = this.latest;
    if (!nb || nb === this.written) return;
    this.local.cancel();
    if (this.deps.saveLocalNow?.(nb, this.revision)) this.written = nb;
    else void this.writeLocal();
  }

  private changed(nb: Notebook) {
    if (this.stopped) return;
    this.latest = nb;
    this.local.poke();
    if (this.paused) return;
    // while failing, the backoff timer decides when to try again
    if (this.failures === 0) {
      this.cloud.poke();
      this.deps.onStatus('idle');
    }
  }

  private writeLocal(): Promise<void> {
    const nb = this.latest;
    if (!nb) return this.localChain;
    const base = this.revision;
    this.written = nb;
    this.localChain = this.localChain
      .then(() => this.deps.saveLocal(nb, base))
      .catch((e) => console.warn('[autosave] device copy failed', e));
    return this.localChain;
  }

  private writeCloud(): Promise<void> {
    // a save in flight sends the newer state when it settles
    if (this.inFlight) return this.inFlight;
    const nb = this.latest;
    if (!nb || this.paused) return Promise.resolve();
    this.deps.onStatus('saving');
    this.inFlight = this.deps
      .saveCloud(nb, this.revision)
      .catch((e: unknown): SaveResult => ({ ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) }))
      .then(async (res) => {
        if (res.ok) {
          this.failures = 0;
          this.revision = res.revision;
          this.deps.onSaved(nb, res.revision);
          if (this.latest === nb) {
            // the cloud has exactly what the outbox would hold: drop it
            this.latest = null;
            this.local.cancel();
            await this.localChain;
            await this.deps.clearLocal(nb.id).catch(() => undefined);
            this.deps.onStatus('saved');
          } else if (!this.stopped) {
            // edited during the save: rewrite the device copy against the new base, then send
            this.local.poke();
            this.cloud.at(0);
          }
          return;
        }
        if (res.reason === 'conflict' || res.reason === 'too_large') {
          this.paused = res.reason === 'conflict';
          this.deps.onStatus(res.reason === 'conflict' ? 'conflict' : 'error', res.message ?? res.reason);
          return;
        }
        this.failures += 1;
        this.lastFailure = res.reason === 'network' ? 'offline' : res.reason === 'auth' ? 'auth' : 'error';
        this.deps.onStatus(this.lastFailure, res.message);
        if (!this.stopped) this.cloud.at(Math.min(TIMING.retryMax, TIMING.retryMin * 2 ** (this.failures - 1)));
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
