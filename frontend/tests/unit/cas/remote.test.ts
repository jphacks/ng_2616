import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CasPayload } from '../../../src/core/cas/payload';
import { RemoteCasController } from '../../../src/core/cas/remote';

// run with: npx tsx --test --conditions=react-server <file>

const VERSIONS = { sympy: '1.14.0', mpmath: '1.4.1', rules: '2.0.0', digest: '0123456789abcdef' };
const PAYLOAD: CasPayload = { lines: [], target: { id: 't', role: 'step', segments: [] }, parent_id: null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const healthy = () => json(200, { ok: true, data: { status: 'ok', cas_ready: true, versions: VERSIONS } });

/** A gateway that answers health as ready and each verify from `answers` in turn. */
function gateway(answers: (() => Response | Promise<Response>)[]) {
  const posts: unknown[] = [];
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    if (String(url).endsWith('health')) return healthy();
    posts.push(JSON.parse(init.body as string));
    const next = answers[Math.min(posts.length - 1, answers.length - 1)];
    return next();
  }) as typeof fetch;
  return { cas: new RemoteCasController('/api/v1/cas/', fetchFn), posts };
}

describe('RemoteCasController', () => {
  it('becomes ready with the worker’s versions in its version string', async () => {
    const { cas } = gateway([]);
    const states: string[] = [];
    cas.onChange((s) => states.push(s));
    assert.equal(cas.versionString, 'unloaded');
    assert.equal(await cas.start(), true);
    assert.deepEqual(states, ['loading', 'ready']);
    assert.equal(cas.versionString, 'azure / sympy 1.14.0 / rules 2.0.0+0123456789abcdef');
  });

  it('returns the worker’s proof and CAS time for a check', async () => {
    const { cas, posts } = gateway([() => json(200, { ok: true, data: { proof: { status: 'ok', segment_results: [] }, elapsed_ms: 4.2 } })]);
    await cas.start();
    const out = await cas.verify(PAYLOAD);
    assert.equal(out.kind, 'ok');
    assert.equal(out.kind === 'ok' && out.proof.status, 'ok');
    assert.equal(out.kind === 'ok' && out.elapsedMs, 4.2);
    assert.deepEqual(posts[0], PAYLOAD);
  });

  it('maps the worker’s timeout and error to the same outcomes as the Pyodide worker', async () => {
    let { cas } = gateway([() => json(504, { ok: false, error: { code: 'CAS_TIMEOUT', message: 'x' } })]);
    await cas.start();
    assert.equal((await cas.verify(PAYLOAD)).kind, 'timeout');
    ({ cas } = gateway([() => json(500, { ok: false, error: { code: 'CAS_ERROR', message: 'x' } })]));
    await cas.start();
    assert.equal((await cas.verify(PAYLOAD)).kind, 'error');
  });

  it('retries a busy checker, then reports unavailable if it stays busy', async () => {
    const busy = () => json(429, { ok: false, error: { code: 'CAS_BUSY', message: 'x' } });
    const done = () => json(200, { ok: true, data: { proof: { status: 'ok' }, elapsed_ms: 1 } });
    let { cas, posts } = gateway([busy, done]);
    await cas.start();
    assert.equal((await cas.verify(PAYLOAD)).kind, 'ok');
    assert.equal(posts.length, 2);
    ({ cas, posts } = gateway([busy]));
    await cas.start();
    assert.equal((await cas.verify(PAYLOAD)).kind, 'unavailable');
    assert.equal(posts.length, 3);
  });

  it('checks one payload at a time, in order', async () => {
    let inFlight = 0;
    let most = 0;
    const slow = async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return json(200, { ok: true, data: { proof: { status: 'ok' }, elapsed_ms: 1 } });
    };
    const { cas, posts } = gateway([slow]);
    await cas.start();
    const a = { ...PAYLOAD, target: { ...PAYLOAD.target, id: 'a' } };
    const b = { ...PAYLOAD, target: { ...PAYLOAD.target, id: 'b' } };
    await Promise.all([cas.verify(a), cas.verify(b)]);
    assert.equal(most, 1);
    assert.deepEqual(
      posts.map((p) => (p as CasPayload).target.id),
      ['a', 'b'],
    );
  });

  it('fails at once when the server says CAS is not configured', async () => {
    const fetchFn = (async () => json(503, { ok: false, error: { code: 'CAS_UNAVAILABLE', message: 'configure CAS_WORKER_URL' } })) as typeof fetch;
    const cas = new RemoteCasController('/api/v1/cas/', fetchFn);
    assert.equal(await cas.start(), false);
    assert.equal(cas.status, 'failed');
    assert.equal((await cas.verify(PAYLOAD)).kind, 'unavailable');
  });
});
