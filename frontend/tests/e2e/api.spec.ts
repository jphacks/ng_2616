import { expect, test } from './fixtures';

const meta = () => ({
  request_id: crypto.randomUUID(),
  notebook_id: crypto.randomUUID(),
  client_session_id: crypto.randomUUID(),
  client_epoch: 1,
  context_fingerprint: `sha256:${'0'.repeat(64)}`,
});

const suggestInput = (target = 'L2') => ({
  context: {
    problem: { id: 'p', title: 't', statement: [], definitions: [], conditions: [], assumptions: [], unknowns: [] },
    lines: [],
  },
  mode: 'NEXT_STEP',
  based_on_line_id: 'L1',
  target_line_id: target,
  rejected_hashes: [],
  ui_lang: 'en',
});

test.describe('/api/v1 gateway', () => {
  test('health is public and never cached', async ({ request }) => {
    const r = await request.get('/api/v1/health');
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toContain('no-store');
    expect((await r.json()).data.status).toBe('ok');
  });

  test('unknown routes are JSON 404s, not HTML', async ({ request }) => {
    const r = await request.get('/api/v1/nope');
    expect(r.status()).toBe(404);
    expect(await r.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  test('job requests need an Idempotency-Key and a valid envelope', async ({ request }) => {
    const noKey = await request.post('/api/v1/suggest', { data: { meta: meta(), input: suggestInput() } });
    expect(noKey.status()).toBe(400);
    const bad = await request.post('/api/v1/suggest', { headers: { 'idempotency-key': crypto.randomUUID() }, data: { meta: meta(), input: { mode: 'NEXT_STEP' } } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe('INVALID_REQUEST');
    const notJson = await request.post('/api/v1/suggest', { headers: { 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' }, data: '{not json' });
    expect(notJson.status()).toBe(400);
  });

  test('a retried request returns the same job; changed input with the same key conflicts', async ({ request }) => {
    const key = crypto.randomUUID();
    const body = { meta: meta(), input: suggestInput() };
    const a = await request.post('/api/v1/suggest', { headers: { 'idempotency-key': key }, data: body });
    const b = await request.post('/api/v1/suggest', { headers: { 'idempotency-key': key }, data: body });
    expect(a.status()).toBe(202);
    expect((await a.json()).data.job.id).toBe((await b.json()).data.job.id);
    const c = await request.post('/api/v1/suggest', { headers: { 'idempotency-key': key }, data: { meta: meta(), input: suggestInput('L9') } });
    expect(c.status()).toBe(409);
    expect((await c.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('bodies above 2 MiB are rejected', async ({ request }) => {
    const r = await request.post('/api/v1/recognize', {
      headers: { 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' },
      data: JSON.stringify({ meta: meta(), input: { pad: 'x'.repeat(2 * 1024 * 1024 + 10) } }),
    });
    expect(r.status()).toBe(413);
  });
});
