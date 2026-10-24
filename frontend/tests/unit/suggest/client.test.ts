import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Job, Meta } from '@mn/contracts';
import { ApiCallError, api } from '../../../src/core/api/client';
import { suggestInput, ZERO } from './fixtures';

const meta: Meta = {
  request_id: '00000000-0000-4000-8000-000000000001',
  notebook_id: '00000000-0000-4000-8000-000000000002',
  client_session_id: '00000000-0000-4000-8000-000000000003',
  client_epoch: 1,
  line_id: 'L1',
  line_version: 1,
  context_fingerprint: ZERO,
};
const input = suggestInput();

const job = (state: Job['state'], extra: Partial<Job> = {}): Job => ({
  id: 'job-1',
  kind: 'suggest',
  state,
  phase: state,
  meta,
  created_at: new Date(0).toISOString(),
  expires_at: new Date(3_600_000).toISOString(),
  ...extra,
});
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify({ ok: true, request_id: 'r', data }), { status });
const failure = (code: string, status: number, retryable = false) => new Response(JSON.stringify({ ok: false, request_id: 'r', error: { code, message: code, retryable } }), { status });
const flush = () => new Promise<void>((r) => setImmediate(r));

interface Call { method: string; url: string; key: string | null; at: number }

/** Replaces fetch with a scripted sequence; every call is recorded with the (fake) time it happened. */
function stubFetch(respond: (call: Call, n: number) => Response | Error | Promise<Response | Error>) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = { method: init?.method ?? 'GET', url: String(url), key: headers.get('idempotency-key'), at: Date.now() };
    calls.push(call);
    const r = await respond(call, calls.length);
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

describe('api.suggest job handling (R31, R32, R34)', () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    mock.timers.reset();
  });

  it('H1 a lost response is retried once with the same Idempotency-Key', async () => {
    const f = stubFetch((_c, n) => (n === 1 ? new TypeError('network down') : envelope({ job: job('succeeded', { result: { state: 'NONE', mock: false } }) }, 202)));
    restore = f.restore;
    const r = await api.suggest(meta, input);
    assert.equal(r.state, 'NONE');
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0]!.method, 'POST');
    assert.ok(f.calls[0]!.key, 'the first request carries a key');
    assert.equal(f.calls[1]!.key, f.calls[0]!.key, 'the retry reuses it');
  });

  it('H1 a second network failure is reported as a retryable NETWORK error, not retried again', async () => {
    const f = stubFetch(() => new TypeError('network down'));
    restore = f.restore;
    await assert.rejects(api.suggest(meta, input), (e: unknown) => e instanceof ApiCallError && e.code === 'NETWORK' && e.retryable);
    assert.equal(f.calls.length, 2);
  });

  it('H1 a conflicting key (409) or other API error is not retried', async () => {
    const f = stubFetch(() => failure('IDEMPOTENCY_CONFLICT', 409));
    restore = f.restore;
    await assert.rejects(api.suggest(meta, input), (e: unknown) => e instanceof ApiCallError && e.code === 'IDEMPOTENCY_CONFLICT' && e.httpStatus === 409);
    assert.equal(f.calls.length, 1);
  });

  it('H2 a succeeded job returns its result', async () => {
    const result = { state: 'GENERATED', mock: false };
    const f = stubFetch(() => envelope({ job: job('succeeded', { result }) }, 202));
    restore = f.restore;
    assert.deepEqual(await api.suggest(meta, input), result);
  });

  it('H2 a failed job keeps its code and whether it may be retried', async () => {
    for (const retryable of [true, false]) {
      const f = stubFetch(() => envelope({ job: job('failed', { error: { code: retryable ? 'UPSTREAM_TIMEOUT' : 'SCHEMA_INVALID', message: 'm', retryable } }) }, 202));
      restore = f.restore;
      await assert.rejects(api.suggest(meta, input), (e: unknown) => e instanceof ApiCallError && e.retryable === retryable && e.code === (retryable ? 'UPSTREAM_TIMEOUT' : 'SCHEMA_INVALID'));
      f.restore();
    }
  });

  it('H2 cancelled and expired jobs are errors, never a result', async () => {
    for (const state of ['cancelled', 'expired'] as const) {
      const f = stubFetch(() => envelope({ job: job(state) }, 202));
      restore = f.restore;
      await assert.rejects(api.suggest(meta, input), (e: unknown) => e instanceof ApiCallError && e.code === 'JOB_FAILED' && e.message === state && !e.retryable);
      f.restore();
    }
  });

  it('H2 a body that is not the API envelope is an UPSTREAM_INVALID error', async () => {
    const f = stubFetch(() => new Response('<html>gateway</html>', { status: 502 }));
    restore = f.restore;
    await assert.rejects(api.suggest(meta, input), (e: unknown) => e instanceof ApiCallError && e.code === 'UPSTREAM_INVALID' && e.retryable);
  });

  it('H3 polls every 1 s for 10 s, every 2 s until 30 s, then every 5 s, and stops at a terminal state', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const start = Date.now();
    const f = stubFetch((c) => {
      if (c.method === 'POST') return envelope({ job: job('queued') }, 202);
      return envelope({ job: Date.now() - start >= 50_000 ? job('succeeded', { result: { state: 'NONE', mock: false } }) : job('running') });
    });
    restore = f.restore;
    const done = api.suggest(meta, input);
    let settled = false;
    void done.then(() => (settled = true));
    for (let i = 0; i < 400 && !settled; i++) {
      await flush();
      mock.timers.tick(250);
    }
    await flush();
    assert.equal(settled, true, 'the poll loop ends once the job succeeds');
    const polls = f.calls.filter((c) => c.method === 'GET').map((c) => c.at - start);
    const gaps = polls.map((t, i) => t - (i === 0 ? 0 : polls[i - 1]!));
    assert.ok(polls.every((_, i) => f.calls.filter((c) => c.method === 'GET')[i]!.url.endsWith('/jobs/job-1')));
    assert.deepEqual(gaps.slice(0, 10), Array(10).fill(1000), 'first ten seconds: 1 s');
    assert.ok(gaps.slice(10, 20).every((g) => g === 2000), 'ten to thirty seconds: 2 s');
    assert.ok(gaps.slice(20).every((g) => g === 5000) && gaps.length > 20, 'after thirty seconds: 5 s');
    const count = f.calls.length;
    mock.timers.tick(60_000);
    await flush();
    assert.equal(f.calls.length, count, 'no polling after the terminal state');
  });

  it('aborting while waiting stops the polling and rejects with AbortError', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const f = stubFetch((c) => (c.method === 'POST' ? envelope({ job: job('queued') }, 202) : envelope({ job: job('running') })));
    restore = f.restore;
    const ctl = new AbortController();
    const p = api.suggest(meta, input, ctl.signal);
    const caught = p.catch((e: unknown) => e);
    await flush();
    mock.timers.tick(1000);
    await flush();
    ctl.abort();
    const e = await caught;
    assert.ok(e instanceof DOMException && e.name === 'AbortError');
    const count = f.calls.length;
    mock.timers.tick(30_000);
    await flush();
    assert.equal(f.calls.length, count);
  });
});
