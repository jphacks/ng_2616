'use client';

import { hashOf, type GraphSpec, type Hash } from '@mn/contracts';

/** A drawn graph, or why it could not be drawn (codes from cas_core/graph.py, plus the worker's own). */
export type GraphImage =
  | { ok: true; png: string; width: number; height: number }
  | { ok: false; code: string; message: string };

// matplotlib is a large download the first time; later starts come from the browser cache
const STARTUP_MS = 120_000;
const RENDER_MS = 20_000;
const CACHE_SIZE = 48;

interface Pending {
  id: number;
  spec: GraphSpec;
  resolve: (r: GraphImage) => void;
}

/**
 * The graph worker (public/cas/graph-worker.js): started on the first graph, one drawing at a
 * time, a drawing that runs past 20 s is stopped by terminating the worker, which starts again on
 * the next request. Drawings are cached by spec, so a graph line re-renders only when it changes.
 */
export class GraphController {
  private worker: Worker | null = null;
  private readyPromise: Promise<boolean> | null = null;
  private failure: string | null = null;
  private queue: Pending[] = [];
  private running: (Pending & { timer: ReturnType<typeof setTimeout> }) | null = null;
  private seq = 0;
  private cache = new Map<Hash, Promise<GraphImage>>();

  constructor(private indexURL: string, private casBase = '/cas/cas_core/') {}

  /** Draws a graph; the same spec returns the same (cached) drawing. */
  render(spec: GraphSpec): Promise<GraphImage> {
    const key = hashOf(spec);
    const hit = this.cache.get(key);
    if (hit) {
      // most recently used last
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const job = this.draw(spec).then((r) => {
      // a worker failure is not the graph's fault: let the next request try again
      if (!r.ok && (r.code === 'GRAPH_UNAVAILABLE' || r.code === 'TIMEOUT')) this.cache.delete(key);
      return r;
    });
    this.cache.set(key, job);
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return job;
  }

  private async draw(spec: GraphSpec): Promise<GraphImage> {
    if (!(await this.start())) return { ok: false, code: 'GRAPH_UNAVAILABLE', message: this.failure ?? 'the graph worker did not start' };
    return new Promise((resolve) => {
      this.seq += 1;
      this.queue.push({ id: this.seq, spec, resolve });
      this.pump();
    });
  }

  private start(): Promise<boolean> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<boolean>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(`/cas/graph-worker.js?v=${encodeURIComponent(this.indexURL)}`, { type: 'module' });
      } catch (e) {
        this.fail(String(e), resolve);
        return;
      }
      this.worker = worker;
      const timer = setTimeout(() => this.fail('the graph worker took longer than 2 minutes to start', resolve), STARTUP_MS);
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.failure = null;
          resolve(true);
          this.pump();
        } else if (msg.type === 'failed') {
          clearTimeout(timer);
          this.fail(msg.error, resolve);
        } else if (msg.type === 'result' || msg.type === 'error') {
          this.finish(msg);
        }
      };
      worker.onerror = (ev) => {
        clearTimeout(timer);
        this.fail(ev.message || 'graph worker error', resolve);
      };
      worker.postMessage({ type: 'init', indexURL: this.indexURL, casBase: this.casBase });
    });
    return this.readyPromise;
  }

  /** A failed start is reported to waiting graphs; the next request starts a fresh worker. */
  private fail(message: string, resolve: (ok: boolean) => void) {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.failure = message;
    resolve(false);
  }

  private pump() {
    if (this.running || !this.worker) return;
    const next = this.queue.shift();
    if (!next) return;
    const timer = setTimeout(() => this.kill(), RENDER_MS);
    this.running = { ...next, timer };
    this.worker.postMessage({ type: 'render', id: next.id, spec: next.spec });
  }

  private finish(msg: { type: string; id: number; result?: GraphImage; error?: string }) {
    const r = this.running;
    if (!r || r.id !== msg.id) return;
    clearTimeout(r.timer);
    this.running = null;
    if (msg.type === 'result' && msg.result) r.resolve(msg.result);
    else r.resolve({ ok: false, code: 'DRAW_FAILED', message: msg.error ?? 'the graph could not be drawn' });
    this.pump();
  }

  /** A drawing past its budget: stop the worker; queued graphs wait for a fresh one. */
  private kill() {
    const r = this.running;
    this.running = null;
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    r?.resolve({ ok: false, code: 'TIMEOUT', message: 'the graph took too long to draw' });
    const waiting = this.queue;
    this.queue = [];
    for (const p of waiting) void this.draw(p.spec).then(p.resolve);
  }
}

let shared: GraphController | null = null;

/** Graphs always draw in this browser, whichever runtime the CAS uses. */
export function getGraphs(): GraphController {
  shared ??= new GraphController(process.env.NEXT_PUBLIC_PYODIDE_INDEX_URL ?? 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/');
  return shared;
}

export const pngSrc = (png: string) => `data:image/png;base64,${png}`;
