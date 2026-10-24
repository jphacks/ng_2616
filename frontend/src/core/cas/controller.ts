'use client';

import type { CasPayload, CasRawProof } from './payload';

export type CasState = 'idle' | 'loading' | 'ready' | 'failed';

export type CasOutcome =
  | { kind: 'ok'; proof: CasRawProof; elapsedMs: number }
  | { kind: 'timeout'; elapsedMs: number }
  | { kind: 'error'; message: string; elapsedMs: number }
  | { kind: 'unavailable' };

const STARTUP_MS = 30_000;
const EXEC_MS = 5_000;

interface Pending {
  id: number;
  payload: CasPayload;
  resolve: (o: CasOutcome) => void;
}

/**
 * One CAS worker per tab (spec §3.1, §9.3): 30 s startup limit, a 5 s execution limit enforced by
 * Worker.terminate() from the main thread, one operation at a time (callers are queued in order),
 * recreate the worker after termination. Startup time never counts toward the 5 s budget.
 */
export class CasController {
  private worker: Worker | null = null;
  private state: CasState = 'idle';
  private listeners = new Set<(s: CasState, detail?: string) => void>();
  private queue: Pending[] = [];
  private running: (Pending & { started: number; timer: ReturnType<typeof setTimeout> }) | null = null;
  private seq = 0;
  private readyPromise: Promise<boolean> | null = null;
  versions: Record<string, string> = {};

  constructor(private indexURL: string, private casBase = '/cas/cas_core/') {}

  get status(): CasState {
    return this.state;
  }

  get versionString(): string {
    const v = this.versions;
    return v.sympy ? `pyodide ${v.pyodide} / sympy ${v.sympy} / rules ${v.rules}+${v.digest}` : 'unloaded';
  }

  onChange(fn: (s: CasState, detail?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(s: CasState, detail?: string) {
    this.state = s;
    for (const fn of this.listeners) fn(s, detail);
  }

  start(): Promise<boolean> {
    if (this.readyPromise && this.state !== 'failed') return this.readyPromise;
    this.readyPromise = new Promise<boolean>((resolve) => {
      this.emit('loading');
      let worker: Worker;
      try {
        worker = new Worker(`/cas/worker.js?v=${encodeURIComponent(this.indexURL)}`, { type: 'module' });
      } catch (e) {
        this.emit('failed', String(e));
        resolve(false);
        return;
      }
      this.worker = worker;
      const timer = setTimeout(() => {
        worker.terminate();
        this.worker = null;
        this.emit('failed', 'startup took longer than 30 s');
        resolve(false);
      }, STARTUP_MS);
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.versions = msg.versions;
          this.emit('ready');
          resolve(true);
          this.pump();
        } else if (msg.type === 'failed') {
          clearTimeout(timer);
          worker.terminate();
          this.worker = null;
          this.emit('failed', msg.error);
          resolve(false);
        } else if (msg.type === 'result' || msg.type === 'error') {
          this.finish(msg);
        }
      };
      worker.onerror = (ev) => {
        clearTimeout(timer);
        this.emit('failed', ev.message || 'worker error');
        resolve(false);
      };
      worker.postMessage({ type: 'init', indexURL: this.indexURL, casBase: this.casBase });
    });
    return this.readyPromise;
  }

  verify(payload: CasPayload): Promise<CasOutcome> {
    if (this.state === 'failed') return Promise.resolve({ kind: 'unavailable' });
    return new Promise((resolve) => {
      this.seq += 1;
      this.queue.push({ id: this.seq, payload, resolve });
      this.pump();
    });
  }

  /** Cancel queued work (Undo / notebook switch). A running operation is terminated. */
  cancelAll() {
    for (const p of this.queue) p.resolve({ kind: 'unavailable' });
    this.queue = [];
    if (this.running) this.kill('cancelled');
  }

  private pump() {
    if (this.running || this.state !== 'ready' || !this.worker) return;
    const next = this.queue.shift();
    if (!next) return;
    const started = performance.now();
    const timer = setTimeout(() => this.kill('timeout'), EXEC_MS);
    this.running = { ...next, started, timer };
    this.worker.postMessage({ type: 'verify', id: next.id, payload: next.payload });
  }

  private finish(msg: { type: string; id: number; proof?: CasRawProof; error?: string }) {
    const r = this.running;
    if (!r || r.id !== msg.id) return;
    clearTimeout(r.timer);
    this.running = null;
    const elapsedMs = performance.now() - r.started;
    // tab throttling can delay timers: reject results that arrive after the budget anyway
    if (elapsedMs > EXEC_MS + 250) r.resolve({ kind: 'timeout', elapsedMs });
    else if (msg.type === 'result' && msg.proof) r.resolve({ kind: 'ok', proof: msg.proof, elapsedMs });
    else r.resolve({ kind: 'error', message: msg.error ?? 'unknown CAS error', elapsedMs });
    this.pump();
  }

  private kill(reason: 'timeout' | 'cancelled') {
    const r = this.running;
    this.running = null;
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    if (r) {
      clearTimeout(r.timer);
      r.resolve(reason === 'timeout' ? { kind: 'timeout', elapsedMs: performance.now() - r.started } : { kind: 'unavailable' });
    }
    this.emit('loading', 'restarting the checker');
    void this.start();
  }

  dispose() {
    this.cancelAll();
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}

let shared: CasController | null = null;

export function getCas(): CasController {
  if (!shared) {
    shared = new CasController(process.env.NEXT_PUBLIC_PYODIDE_INDEX_URL ?? 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/');
  }
  return shared;
}
