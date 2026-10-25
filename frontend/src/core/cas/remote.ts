'use client';

import type { CasOutcome, CasState } from './controller';
import type { CasPayload, CasRawProof } from './payload';

const STARTUP_MS = 30_000;
// the gateway gives up at 12 s (worker's 5 s check, 3 s queue wait, the trip to the VM)
const REQUEST_MS = 15_000;
// busy or starting is the server's to recover from: try a little later before giving up
const RETRIES = 2;
const RETRY_MS = 600;

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
interface Health {
  cas_ready: boolean;
  versions: { sympy: string; mpmath: string; rules: string; digest: string } | null;
}
interface Verified {
  proof: CasRawProof;
  elapsed_ms: number;
}

interface Pending {
  payload: CasPayload;
  resolve: (o: CasOutcome) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The CAS on the Azure VM (ADR 0009), behind the same interface as the Pyodide CasController so the
 * engine cannot tell them apart: one check at a time in order, the same outcomes, and a version
 * string that changes every input hash when the runtime changes.
 */
export class RemoteCasController {
  private state: CasState = 'idle';
  private listeners = new Set<(s: CasState, detail?: string) => void>();
  private queue: Pending[] = [];
  private running: AbortController | null = null;
  private readyPromise: Promise<boolean> | null = null;
  versions: Record<string, string> = {};

  constructor(
    private base = '/api/v1/cas/',
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  get status(): CasState {
    return this.state;
  }

  get versionString(): string {
    const v = this.versions;
    return v.sympy ? `azure / sympy ${v.sympy} / rules ${v.rules}+${v.digest}` : 'unloaded';
  }

  onChange(fn: (s: CasState, detail?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(s: CasState, detail?: string) {
    this.state = s;
    for (const fn of this.listeners) fn(s, detail);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal): Promise<{ status: number; env: Envelope<T> | null }> {
    const res = await this.fetchFn(this.base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
    return { status: res.status, env: (await res.json().catch(() => null)) as Envelope<T> | null };
  }

  start(): Promise<boolean> {
    if (this.readyPromise && this.state !== 'failed') return this.readyPromise;
    this.readyPromise = (async () => {
      this.emit('loading');
      const deadline = Date.now() + STARTUP_MS;
      let detail = 'the checker did not start';
      while (Date.now() < deadline) {
        try {
          const { env } = await this.call<Health>('GET', 'health', undefined, AbortSignal.timeout(REQUEST_MS));
          if (env?.ok && env.data.cas_ready && env.data.versions) {
            this.versions = env.data.versions;
            this.emit('ready');
            this.pump();
            return true;
          }
          // a refused sign-in or a missing configuration will not fix itself by waiting
          if (env && !env.ok && ['AUTH_REQUIRED', 'CAS_UNAVAILABLE'].includes(env.error.code)) {
            detail = env.error.message;
            break;
          }
        } catch {
          detail = 'the checker is not reachable';
        }
        await wait(1000);
      }
      this.emit('failed', detail);
      return false;
    })();
    return this.readyPromise;
  }

  verify(payload: CasPayload): Promise<CasOutcome> {
    if (this.state === 'failed') return Promise.resolve({ kind: 'unavailable' });
    return new Promise((resolve) => {
      this.queue.push({ payload, resolve });
      this.pump();
    });
  }

  /** Cancel queued work (Undo / notebook switch). A running check is abandoned. */
  cancelAll() {
    for (const p of this.queue) p.resolve({ kind: 'unavailable' });
    this.queue = [];
    this.running?.abort();
  }

  private pump() {
    if (this.running || this.state !== 'ready') return;
    const next = this.queue.shift();
    if (!next) return;
    const ctl = new AbortController();
    this.running = ctl;
    void this.check(next.payload, ctl).then((outcome) => {
      if (this.running === ctl) this.running = null;
      next.resolve(outcome);
      this.pump();
    });
  }

  private async check(payload: CasPayload, ctl: AbortController): Promise<CasOutcome> {
    const started = performance.now();
    const elapsed = () => performance.now() - started;
    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(REQUEST_MS)]);
      let status: number;
      let env: Envelope<Verified> | null;
      try {
        ({ status, env } = await this.call<Verified>('POST', 'verify', payload, signal));
      } catch {
        if (ctl.signal.aborted) return { kind: 'unavailable' };
        if (signal.aborted) return { kind: 'timeout', elapsedMs: elapsed() };
        if (attempt < RETRIES) {
          await wait(RETRY_MS);
          continue;
        }
        return { kind: 'unavailable' };
      }
      if (env?.ok) return { kind: 'ok', proof: env.data.proof, elapsedMs: env.data.elapsed_ms };
      const code = env?.error.code ?? '';
      if (code === 'CAS_TIMEOUT') return { kind: 'timeout', elapsedMs: elapsed() };
      if (code === 'CAS_ERROR') return { kind: 'error', message: env?.error.message ?? 'CAS error', elapsedMs: elapsed() };
      if (attempt < RETRIES && (code === 'CAS_BUSY' || code === 'CAS_STARTING' || status >= 500)) {
        await wait(RETRY_MS * (attempt + 1));
        continue;
      }
      return { kind: 'unavailable' };
    }
  }

  dispose() {
    this.cancelAll();
    this.listeners.clear();
  }
}
