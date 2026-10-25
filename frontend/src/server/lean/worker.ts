import 'server-only';

/** One step as lean-worker reports it (lean-worker/lean_worker/main.py). */
export interface WorkerStep {
  index: number;
  state: 'ok' | 'failed' | 'unchecked' | 'empty';
  messages: string[];
}

export interface WorkerCheck {
  state: 'proved' | 'incomplete' | 'failed' | 'invalid' | 'timeout';
  steps: WorkerStep[];
  goals?: string | null;
  statement_error?: string | null;
  /** the worker refused the source before running it (sorry, IO, commands…) */
  rejected?: boolean;
  elapsed_ms: number;
  toolchain: string;
  mathlib: string;
}

export interface WorkerHealth {
  lean_ready: boolean;
  toolchain: string;
  mathlib: string;
  error?: string | null;
}

export class LeanUnavailable extends Error {}

/** What the Lean service needs from lean-worker; tests pass a fake. */
export interface LeanWorker {
  check(statement: string, steps: string[], signal: AbortSignal): Promise<WorkerCheck>;
  health(signal: AbortSignal): Promise<WorkerHealth>;
}

/** lean-worker over HTTP (loopback in development, a private network later; ADR 0008). */
export class HttpLeanWorker implements LeanWorker {
  constructor(
    private url: string,
    private key: string | undefined,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url.replace(/\/$/, '')}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.key ? { 'x-lean-key': this.key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: 'error',
        cache: 'no-store',
      });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new LeanUnavailable('Lean worker is not reachable');
    }
    const parsed = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: { message?: string } } | null;
    if (!res.ok || !parsed?.ok || parsed.data === undefined) throw new LeanUnavailable(parsed?.error?.message ?? `Lean worker error ${res.status}`);
    return parsed.data;
  }

  check(statement: string, steps: string[], signal: AbortSignal) {
    return this.call<WorkerCheck>('POST', '/check', { statement, steps }, signal);
  }

  health(signal: AbortSignal) {
    return this.call<WorkerHealth>('GET', '/health', undefined, signal);
  }
}
