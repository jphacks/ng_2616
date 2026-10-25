import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { graphOf, type GraphWire, type SuggestInput } from '@mn/contracts';
import { payloadForLine } from '../../../src/core/cas/payload';
import { graphCandidate } from '../../../src/server/ai/direct/candidate';
import { line, segs, settled } from './fixtures';
import { candidateOf, fakeGraphs, lineOf, rig, until, type Rig } from './harness';

let r: Rig;
afterEach(() => {
  r?.dispose();
  mock.timers.reset();
});

const SINE: GraphWire = {
  has_graph: true,
  kind: '2d',
  title: 'A sine wave',
  x_label: '$x$',
  y_label: '$y$',
  x_range: [0, 6],
  series: [{ type: 'function', y: '\\sin x' }],
};

/** What the server returns for a GRAPH request: the model's graph, parsed. */
const graphDraft = (input: SuggestInput, wire: GraphWire = SINE) => graphCandidate(input, wire, false);

/** A request line as recognition leaves it: words (and maybe a formula), marked as asking for a graph. */
const request = (id: string, src: string) => ({
  ...line(id, 'SETTLED'),
  segments: src.includes('$') ? segs(src) : [{ type: 'text' as const, text: src }],
  extensions: { route: 'none', graph_request: true },
});

async function shown(rg: Rig) {
  await rg.engine.requestSuggestion(true);
  await until(() => ['READY', 'HELD'].includes(candidateOf(rg)?.state ?? ''), 'a finished candidate');
  return candidateOf(rg)!;
}

describe('graph lines: a request is answered with a graph the browser has drawn', () => {
  it('asks for a GRAPH based on the request line, and shows the graph once it draws', async () => {
    r = rig({ lines: [settled('L1', '$y = \\sin x$', 'none'), request('L2', 'plot this'), line('D1', 'DRAFT')], answer: (input) => graphDraft(input) });
    const c = await shown(r);
    const call = r.api.suggestCalls[0]!.input;
    assert.equal(call.mode, 'GRAPH');
    assert.equal(call.based_on_line_id, 'L2');
    assert.equal(call.target_line_id, 'D1');
    assert.equal(r.graphs.rendered.length, 1, 'drawn once before it is shown');
    assert.equal(c.policy, 'verified');
    assert.equal(graphOf(c.lines[0]!)?.title, 'A sine wave');
    assert.equal(r.cas.verified.length, 0, 'the CAS never sees a graph');
  });

  it('adopting it adds a text line that carries the graph, with no verdict, then suggestions continue as before', async () => {
    r = rig({ lines: [settled('L1', '$y = \\sin x$', 'none'), request('L2', 'plot this'), line('D1', 'DRAFT')], answer: (input) => graphDraft(input) });
    const c = await shown(r);
    assert.equal(r.engine.adopt(), 'adopted');
    const g = lineOf(r, c.targetLineId)!;
    assert.equal(g.source, 'ai');
    assert.equal(g.role, 'text');
    assert.equal(g.verified, undefined);
    assert.deepEqual(g.segments, [{ type: 'text', text: 'A sine wave' }]);
    assert.equal(graphOf(g)?.series[0]!.type, 'function');
    assert.deepEqual(g.ai_origin, { candidate_id: c.id, mode: 'GRAPH' });
    // the request is answered: the next suggestion continues the derivation
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 2, 'the next request');
    assert.equal(r.api.suggestCalls[1]!.input.mode, 'NEXT_STEP');
  });

  it('a graph that does not draw goes back to the model with the reason, and the corrected one is shown', async () => {
    let calls = 0;
    const graphs = fakeGraphs(() => (calls++ === 0 ? { ok: false, code: 'UNKNOWN_SYMBOL', message: 'k has no value' } : { ok: true, png: '', width: 1, height: 1 }));
    r = rig({
      lines: [request('L1', 'plot sin kx'), line('D1', 'DRAFT')],
      graphs,
      answer: (input) => graphDraft(input, input.checker_feedback?.length ? SINE : { ...SINE, series: [{ type: 'function', y: '\\sin(k x)' }] }),
    });
    await shown(r);
    assert.equal(r.api.suggestCalls.length, 2);
    const fb = r.api.suggestCalls[1]!.input.checker_feedback!;
    assert.equal(fb[0]!.reason, 'UNKNOWN_SYMBOL');
    assert.deepEqual(fb[0]!.evidence, ['k has no value']);
    assert.match(fb[0]!.latex, /y = \\sin\(k x\)/);
  });

  it('a request without a formula is answered even before the student has written any mathematics', async () => {
    r = rig({ lines: [settled('P1', '$V(x) = 0$', 'none', undefined, { role: 'premise' }), request('L1', 'visualize the potential'), line('D1', 'DRAFT')], answer: (input) => graphDraft(input) });
    assert.equal(r.engine.canSuggest(), true);
    await shown(r);
    assert.equal(r.api.suggestCalls[0]!.input.mode, 'GRAPH');
  });

  it('a request settles without a CAS check, and stays out of later lines\' CAS context', async () => {
    const asking = { ...request('L2', 'plot $y = x^2$'), state: 'VERIFYING' as const };
    r = rig({ lines: [settled('L1', '$x = 1$', 'ok'), asking, settled('L3', '$x + 1 = 2$', 'ok')], answer: () => ({ state: 'NONE', mock: false }) });
    const before = r.cas.verified.length;
    await r.engine.verifyLine('L2');
    assert.equal(lineOf(r, 'L2')!.state, 'SETTLED');
    assert.equal(lineOf(r, 'L2')!.verified, undefined);
    assert.equal(r.cas.verified.length, before, 'no CAS call for the request');
    const payload = payloadForLine(r.store.getState().notebook!, 'L3');
    assert.deepEqual(payload.lines.map((l) => l.id), ['L1']);
  });

  it('a graph line answers its request: no second graph is asked for', async () => {
    r = rig({ lines: [settled('L1', '$y = \\sin x$', 'none'), request('L2', 'plot this'), line('D1', 'DRAFT')], answer: (input) => graphDraft(input) });
    await shown(r);
    r.engine.adopt();
    await r.engine.requestSuggestion(true);
    await until(() => r.api.suggestCalls.length === 2, 'the next request');
    assert.notEqual(r.api.suggestCalls[1]!.input.mode, 'GRAPH');
  });
});
