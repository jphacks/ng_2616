import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTag, normalizeTags, type Line, type Notebook, type Proof } from '@mn/contracts';
import { activity, addDays, streak, subjects, totals } from '../../src/core/insights/aggregate';
import { notebookStats, RETAG_AFTER_MS, shouldRetag, tagKey, tagLines, withDay } from '../../src/core/insights/stats';
import type { NotebookInsight } from '../../src/core/insights/store';
import { overlapping, radii, seed, settle } from '../../src/components/home/progress/bubbles';

const proof = (status: Proof['status']): Proof => ({
  status,
  conditions: [],
  evidence: [],
  hints: [],
  segment_results: [],
  depends_on: [],
  depends_on_unverified: false,
  unverified_ancestors: [],
  input_hash: `sha256:${'0'.repeat(64)}`,
  mock: false,
  cas: { version: 'test', rules_version: '2.0.0', elapsed_ms: 1, timed_out: false },
});
const math = (latex: string) => [{ type: 'math' as const, expr: 'x', notation: 'plain' as const, latex }];
const line = (id: string, extra: Partial<Line> = {}): Line => ({ id, version: 1, source: 'user', role: 'step', state: 'SETTLED', ink: [], segments: math(id), ...extra });
const checked = (id: string, status: Proof['status'], extra: Partial<Line> = {}) =>
  line(id, { verified: { verification_id: id, input_hash: `sha256:${'0'.repeat(64)}`, proof: proof(status) }, ...extra });
const notebook = (lines: Line[], recoveries: Notebook['recoveries'] = []): Notebook => ({
  schema_version: '2.2.0',
  id: '00000000-0000-4000-8000-000000000010',
  title: 'Limits',
  mode: 'live',
  domain: 'Reals',
  lines,
  recoveries,
});

describe('notebook stats', () => {
  it('counts the student’s settled work, not the problem or drafts', () => {
    const nb = notebook([
      line('G1', { role: 'premise' }),
      checked('L1', 'ok'),
      checked('L2', 'wrong', { state: 'SUPERSEDED' }),
      checked('L3', 'ok', { revision_of: 'L2' }),
      checked('L4', 'unknown', { source: 'ai', ai_origin: { candidate_id: 'c', mode: 'NEXT_STEP' } }),
      checked('L5', 'ok', { ai_origin: { candidate_id: 'd', mode: 'COMPLETE_RHS' } }),
      line('D1', { state: 'DRAFT', segments: [] }),
    ], [
      { root_line_id: 'L2', current_line_id: 'L3', phase: 'RECOVERED', opened_at: { hint1: 1, hint2: 2 } },
      { root_line_id: 'L9', current_line_id: 'L9', phase: 'HINT_FOCUS', opened_at: { hint1: 3 } },
    ]);
    const s = notebookStats(nb);
    assert.equal(s.lines, 4);
    assert.equal(s.ai_lines, 2);
    assert.deepEqual(s.ai_modes, { COMPLETE_RHS: 1, NEXT_STEP: 1, BRIDGE: 0 });
    assert.deepEqual(s.checked, { ok: 3, wrong: 0, unknown: 1 });
    assert.equal(s.mistakes, 2);
    assert.equal(s.fixed, 1);
    assert.equal(s.hints, 3);
  });

  it('counts Lean proofs once per theorem, and line-scoped proofs each', () => {
    const lean = (step: string, proof?: string, scope?: string) => ({ route: 'lean', lean: { tactic: 't', step, proof, scope } });
    const s = notebookStats(notebook([
      checked('L1', 'unknown', { extensions: lean('ok', 'incomplete') }),
      checked('L2', 'unknown', { extensions: lean('ok', 'proved') }),
      checked('L3', 'unknown', { extensions: lean('ok', 'proved', 'line') }),
    ]));
    assert.equal(s.lean_steps, 3);
    assert.equal(s.lean_proofs, 2);
    // a proof step's CAS "unknown" is not a verdict
    assert.deepEqual(s.checked, { ok: 0, wrong: 0, unknown: 0 });
  });
});

describe('re-tagging', () => {
  const nb = notebook([line('G1', { role: 'premise' }), line('L1'), line('L2')]);
  const key = tagKey(nb);
  const now = Date.parse('2026-10-25T12:00:00Z');

  it('tags a notebook the first time it has two lines', () => {
    const never = { tags_hash: null, tags_lines: 0, tagged_at: null };
    assert.equal(shouldRetag(never, key, tagLines(nb), now), true);
    assert.equal(shouldRetag(never, key, 1, now), false);
  });

  it('waits for three more lines, or six hours, before reading the tags again', () => {
    const tagged = { tags_hash: 'sha256:old', tags_lines: 3, tagged_at: new Date(now - 60_000).toISOString() };
    assert.equal(shouldRetag({ ...tagged, tags_hash: key }, key, 9, now), false, 'unchanged content');
    assert.equal(shouldRetag(tagged, key, 4, now), false);
    assert.equal(shouldRetag(tagged, key, 6, now), true);
    assert.equal(shouldRetag({ ...tagged, tagged_at: new Date(now - RETAG_AFTER_MS).toISOString() }, key, 4, now), true);
  });

  it('keys the tags on the title and the settled text only', () => {
    assert.equal(tagKey({ ...nb, lines: [...nb.lines, line('D', { state: 'DRAFT' })] }), key);
    assert.notEqual(tagKey({ ...nb, title: 'Series' }), key);
  });
});

describe('tags', () => {
  it('normalizes the spelling so one subject is one bubble', () => {
    assert.equal(normalizeTag('  Real   Analysis. '), 'real analysis');
    assert.equal(normalizeTag('"Epsilon-Delta_Limits"'), 'epsilon-delta limits');
    assert.deepEqual(normalizeTags(['Analysis', 'analysis', 'Real Analysis', '', 'Limits', 'Extra']), ['analysis', 'real analysis', 'limits']);
  });
});

describe('aggregation', () => {
  const row = (id: string, tags: string[], days: string[] = []): NotebookInsight => ({
    notebook_id: id,
    tags,
    stats: { ...notebookStats(notebook([line('L1'), line('L2', { source: 'ai' })])) },
    active_days: days,
  });
  const rows = [
    row('a', ['analysis', 'real analysis', 'limits'], ['2026-10-24', '2026-10-25']),
    row('b', ['analysis', 'complex analysis', 'residues'], ['2026-10-23']),
    row('c', ['analysis', 'real analysis', 'series'], ['2026-10-25']),
  ];

  it('sizes subjects by notebooks and keeps the broad field above its subfields', () => {
    const s = subjects(rows);
    assert.deepEqual(s.slice(0, 3).map((x) => [x.tag, x.notebooks, x.level]), [
      ['analysis', 3, 0],
      ['real analysis', 2, 1],
      ['complex analysis', 1, 1],
    ]);
  });

  it('sums the counts and the days', () => {
    const t = totals(rows);
    assert.equal(t.notebooks, 3);
    assert.equal(t.lines, 6);
    assert.equal(t.ai_lines, 3);
    const days = activity(rows);
    assert.equal(days.get('2026-10-25'), 2);
    assert.equal(streak(days, '2026-10-25'), 3);
    assert.equal(streak(days, '2026-10-26'), 3, 'today without work yet keeps yesterday’s streak');
    assert.equal(streak(days, '2026-10-27'), 0);
  });

  it('adds days across month ends and keeps them sorted and distinct', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.deepEqual(withDay(['2026-10-24'], '2026-10-20'), ['2026-10-20', '2026-10-24']);
    assert.deepEqual(withDay(['2026-10-24'], '2026-10-24'), ['2026-10-24']);
  });
});

describe('subject cloud layout', () => {
  it('packs bubbles without overlap, the biggest nearest the center', () => {
    const values = [9, 6, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1];
    const [w, h] = [460, 320];
    const rs = radii(values, w, h);
    const nodes = seed(values.map((v, i) => ({ id: `t${i}`, r: rs[i]! })), w, h);
    settle(nodes, w, h);
    assert.equal(overlapping(nodes), false);
    for (const n of nodes) {
      assert.ok(n.x >= n.r - 0.01 && n.x <= w - n.r + 0.01 && n.y >= n.r - 0.01 && n.y <= h - n.r + 0.01, `${n.id} stays inside`);
    }
    const dist = (id: string) => {
      const n = nodes.find((b) => b.id === id)!;
      return Math.hypot(n.x - w / 2, n.y - h / 2);
    };
    const smallest = Math.min(...['t9', 't10', 't11', 't12', 't13', 't14', 't15'].map(dist));
    assert.ok(dist('t0') < smallest, 'the biggest subject sits closer to the center than any small one');
  });
});
