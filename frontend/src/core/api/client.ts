'use client';

import type {
  CandidateDraftResult,
  Capabilities,
  Job,
  Meta,
  OcrPageInput,
  OcrPageResult,
  RecognizeInput,
  RecognizeResult,
  SuggestInput,
} from '@mn/contracts';
import { uuid } from '@/core/ids';

export class ApiCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

type Envelope<T> = { ok: true; request_id: string; data: T } | { ok: false; request_id: string; error: { code: string; message: string; retryable: boolean } };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });

async function request<T>(method: string, path: string, body?: unknown, opts: { key?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.key) headers['idempotency-key'] = opts.key;
  let res: Response;
  try {
    res = await fetch(`/api/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: opts.signal, cache: 'no-store' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiCallError('NETWORK', 'network error', 0, true);
  }
  let parsed: Envelope<T>;
  try {
    parsed = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiCallError('UPSTREAM_INVALID', `unexpected response (${res.status})`, res.status, res.status >= 500);
  }
  if (!parsed.ok) throw new ApiCallError(parsed.error.code, parsed.error.message, res.status, parsed.error.retryable);
  return parsed.data;
}

/** POST a job; a lost response is retried once with the same Idempotency-Key (spec §7.2). */
async function runJob<T>(path: string, meta: Meta, input: unknown, signal?: AbortSignal): Promise<T> {
  const key = uuid();
  let data: { job: Job<T> };
  try {
    data = await request<{ job: Job<T> }>('POST', path, { meta, input }, { key, signal });
  } catch (e) {
    if (e instanceof ApiCallError && e.code === 'NETWORK') data = await request<{ job: Job<T> }>('POST', path, { meta, input }, { key, signal });
    else throw e;
  }
  let job = data.job;
  const started = Date.now();
  while (job.state === 'queued' || job.state === 'running') {
    const elapsed = Date.now() - started;
    await sleep(elapsed < 10_000 ? 1000 : elapsed < 30_000 ? 2000 : 5000, signal);
    job = (await request<{ job: Job<T> }>('GET', `jobs/${job.id}`, undefined, { signal })).job;
  }
  if (job.state === 'succeeded' && job.result !== undefined) return job.result;
  throw new ApiCallError(job.error?.code ?? 'JOB_FAILED', job.error?.message ?? job.state, 200, job.error?.retryable ?? false);
}

export const api = {
  capabilities: (signal?: AbortSignal) => request<Capabilities>('GET', 'capabilities', undefined, { signal }),
  recognize: (meta: Meta, input: RecognizeInput, signal?: AbortSignal) => runJob<RecognizeResult>('recognize', meta, input, signal),
  suggest: (meta: Meta, input: SuggestInput, signal?: AbortSignal) => runJob<CandidateDraftResult>('suggest', meta, input, signal),
  ocrPage: (meta: Meta, input: OcrPageInput, signal?: AbortSignal) => runJob<OcrPageResult>('resources/page', meta, input, signal),
};
