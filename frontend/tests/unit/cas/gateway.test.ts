import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

// run with: npx tsx --test --conditions=react-server <file>

// the dev bypass signs requests in as the dev user; serverEnv() reads these once
Object.assign(process.env, {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  NEXT_PUBLIC_AUTH_DEV_BYPASS: 'true',
  CAS_WORKER_URL: 'http://127.0.0.1:8200',
  CAS_WORKER_KEY: 'k'.repeat(48),
});

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function worker(handler: Handler) {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PAYLOAD = { lines: [], target: { id: 't', role: 'step', segments: [] }, parent_id: null };
const post = (body: unknown) => new Request('http://app/api/v1/cas/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let casVerify: (r: Request) => Promise<Response>;
let casHealth: (r: Request) => Promise<Response>;

before(async () => {
  ({ casVerify, casHealth } = await import('../../../src/server/cas'));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('CAS gateway', () => {
  it('forwards the payload with the worker key and returns the proof', async () => {
    worker(() => json(200, { ok: true, data: { proof: { status: 'ok' }, elapsed_ms: 3 } }));
    const res = await casVerify(post(PAYLOAD));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { proof: { status: 'ok' }, elapsed_ms: 3 });
    assert.equal(calls[0].url, 'http://127.0.0.1:8200/verify');
    assert.equal((calls[0].init.headers as Record<string, string>)['x-cas-key'], 'k'.repeat(48));
    assert.deepEqual(JSON.parse(calls[0].init.body as string), PAYLOAD);
  });

  it('refuses a body that is not a CAS payload without calling the worker', async () => {
    worker(() => json(200, { ok: true, data: {} }));
    const res = await casVerify(post({ target: 'x' }));
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });

  it('passes the worker’s timeout and busy answers through', async () => {
    for (const [status, code] of [[504, 'CAS_TIMEOUT'], [429, 'CAS_BUSY']] as const) {
      worker(() => json(status, { ok: false, error: { code, message: 'x', retryable: true } }));
      const res = await casVerify(post(PAYLOAD));
      assert.equal(res.status, status);
      assert.equal((await res.json()).error.code, code);
    }
  });

  it('shows a refused key or an unreachable worker to the browser only as unavailable', async () => {
    worker(() => json(403, { ok: false, error: { code: 'CAS_KEY_INVALID', message: 'invalid worker key' } }));
    let res = await casVerify(post(PAYLOAD));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'CAS_UNAVAILABLE');
    worker(() => {
      throw new TypeError('fetch failed');
    });
    res = await casVerify(post(PAYLOAD));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'CAS_UNAVAILABLE');
  });

  it('reports the worker’s health and versions', async () => {
    const versions = { sympy: '1.14.0', mpmath: '1.4.1', rules: '2.0.0', digest: '0123456789abcdef' };
    worker(() => json(200, { ok: true, data: { status: 'ok', cas_ready: true, versions } }));
    const res = await casHealth(new Request('http://app/api/v1/cas/health'));
    assert.deepEqual((await res.json()).data.versions, versions);
    assert.equal(calls[0].url, 'http://127.0.0.1:8200/health');
  });
});
