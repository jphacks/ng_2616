import type { CandidateDraftResult, Line, Notebook, Stroke, SuggestInput } from '@mn/contracts';
import { toInputSegments } from '@mn/contracts';
import type { CasOutcome } from '../../../src/core/cas/controller';
import { inputHash, payloadForLine, type CasPayload, type CasRawProof } from '../../../src/core/cas/payload';
import type { GraphImage } from '../../../src/core/graph/controller';
import { NotebookEngine, type ApiPort, type CasPort, type GraphPort } from '../../../src/core/engine';
import { useNotebook } from '../../../src/core/store/notebook-store';
import { line, notebook, segs, settled, stroke } from './fixtures';

/** What the fake CAS answers for a payload. */
export type CasAnswer = (payload: CasPayload) => CasOutcome | Promise<CasOutcome>;

export const rawProof = (status: 'ok' | 'wrong' | 'unknown' | 'none', extra: Partial<CasRawProof> = {}): CasRawProof => ({
  status,
  conditions: [],
  evidence: [],
  hints: [],
  segment_results: [],
  depends_on: [],
  depends_on_unverified: false,
  unverified_ancestors: [],
  ...extra,
});

export const casOk = (extra: Partial<CasRawProof> = {}): CasOutcome => ({ kind: 'ok', proof: rawProof('ok', extra), elapsedMs: 1 });
export const casStatus = (status: 'ok' | 'wrong' | 'unknown' | 'none', extra: Partial<CasRawProof> = {}): CasOutcome => ({ kind: 'ok', proof: rawProof(status, extra), elapsedMs: 1 });

export interface FakeCas extends CasPort {
  verified: CasPayload[];
  answer: CasAnswer;
  /** pretend the checker is (not) ready; the engine reads `status` each time */
  ready: boolean;
}

export function fakeCas(answer: CasAnswer = () => casOk()): FakeCas {
  const cas: FakeCas = {
    verified: [],
    answer,
    ready: true,
    get status() {
      return cas.ready ? 'ready' : 'loading';
    },
    versionString: 'fake-cas',
    onChange: () => () => undefined,
    start: async () => cas.ready,
    verify: async (payload) => {
      cas.verified.push(payload);
      return cas.answer(payload);
    },
  } as FakeCas;
  return cas;
}

export interface SuggestCall {
  meta: Parameters<ApiPort['suggest']>[0];
  input: SuggestInput;
  signal: AbortSignal | undefined;
}

/** A candidate draft for the input, as the server would return it (formulas only, unverified). */
export function draftFor(input: SuggestInput, src: string, hash = `sha256:${'a'.repeat(64)}`): CandidateDraftResult {
  const segments = segs(src);
  return {
    state: 'GENERATED',
    mock: false,
    candidate: {
      id: crypto.randomUUID(),
      mode: input.mode,
      content_hash: hash as `sha256:${string}`,
      lines: [{ target: { id: input.target_line_id, role: 'step', segments: toInputSegments(segments) }, segments }],
    },
  };
}

export type SuggestAnswer = (input: SuggestInput, call: SuggestCall) => CandidateDraftResult | Promise<CandidateDraftResult>;

export interface FakeApi extends ApiPort {
  suggestCalls: SuggestCall[];
  answer: SuggestAnswer;
}

/** An api whose suggest answers via `answer`; it rejects like fetch does when the request is aborted. */
export function fakeApi(answer: SuggestAnswer): FakeApi {
  const api: FakeApi = {
    suggestCalls: [],
    answer,
    suggest: async (meta, input, signal) => {
      const call: SuggestCall = { meta, input, signal };
      api.suggestCalls.push(call);
      const result = Promise.resolve(api.answer(input, call));
      if (!signal) return result;
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        result.then(resolve, reject);
      });
    },
    recognize: async () => {
      throw new Error('recognize is not part of these tests');
    },
    ocrPage: async () => {
      throw new Error('ocrPage is not part of these tests');
    },
  };
  return api;
}

export interface FakeGraphs extends GraphPort {
  rendered: unknown[];
  answer: () => GraphImage;
}

/** A graph worker that draws nothing: every graph "draws" unless `answer` says otherwise. */
export function fakeGraphs(answer: () => GraphImage = () => ({ ok: true, png: '', width: 960, height: 600 })): FakeGraphs {
  const graphs: FakeGraphs = {
    rendered: [],
    answer,
    render: async (spec) => {
      graphs.rendered.push(spec);
      return graphs.answer();
    },
  };
  return graphs;
}

/** A promise you resolve by hand, to hold a request in flight. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const tick = () => new Promise<void>((r) => setImmediate(r));

/** Wait (in real time) until `ok()` holds; used for state that settles after a few promise turns. */
export async function until(ok: () => boolean, what = 'condition', ms = 2000) {
  const start = Date.now();
  while (!ok()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await tick();
  }
}

export interface Rig {
  engine: NotebookEngine;
  cas: FakeCas;
  api: FakeApi;
  graphs: FakeGraphs;
  toasts: string[];
  store: typeof useNotebook;
  /** the id of the empty draft line below the settled lines */
  draftId: string;
  /** stop the engine and the toast recording; call it at the end of every test */
  dispose(): void;
}

/**
 * Settled lines carry the input hash their check would have now, as in a notebook that was really
 * checked: the engine re-checks a line whose stored hash no longer matches (after Undo, Redo or
 * opening), and a placeholder hash would make every such step call the checker.
 */
function checkedWith(nb: Notebook, casVersion: string): Notebook {
  const lines = nb.lines.map((l) => {
    if (l.state !== 'SETTLED' || !l.verified) return l;
    const hash = inputHash(nb, payloadForLine(nb, l.id), casVersion);
    return { ...l, verified: { ...l.verified, input_hash: hash, proof: { ...l.verified.proof, input_hash: hash } } };
  });
  return { ...nb, lines };
}

/**
 * A NotebookEngine on the real store with a fake CAS and api. The notebook is `lines` (default: one ok line "x = 1" and an
 * empty draft). Toasts are the translation keys the engine asked for.
 */
export function rig(opts: { lines?: Line[]; cas?: FakeCas; api?: FakeApi; answer?: SuggestAnswer; graphs?: FakeGraphs } = {}): Rig {
  const lines = opts.lines ?? [settled('L1', '$x = 1$', 'ok'), line('D1', 'DRAFT')];
  const cas = opts.cas ?? fakeCas();
  const nb: Notebook = checkedWith(notebook(lines), cas.versionString);
  const st = useNotebook.getState();
  st.load(nb, null);
  const api = opts.api ?? fakeApi(opts.answer ?? ((input) => draftFor(input, 'x = 2')));
  const graphs = opts.graphs ?? fakeGraphs();
  const toasts: string[] = [];
  const engine = new NotebookEngine({ ownerId: 'owner', lang: () => 'en', t: (k) => k }, { cas, api, graphs });
  // the toast goes through the store; record its text (the engine passes keys as text through t)
  const stopRecording = useNotebook.subscribe((s, prev) => {
    if (s.toast && s.toast !== prev.toast) toasts.push(s.toast.text);
  });
  const draft = lines.filter((l) => l.state === 'DRAFT').at(-1);
  return {
    engine,
    cas,
    api,
    graphs,
    toasts,
    store: useNotebook,
    draftId: draft?.id ?? '',
    dispose() {
      stopRecording();
      engine.dispose();
    },
  };
}

/** Put an ink stroke on a line through the engine, as the canvas does. */
export function writeStroke(r: Rig, lineId: string, id = `s${Math.random().toString(36).slice(2, 8)}`) {
  const s: Stroke = { ...stroke, id };
  r.engine.addStroke(lineId, s);
}

export const candidateOf = (r: Rig) => r.store.getState().candidate;
export const lineOf = (r: Rig, id: string) => r.store.getState().notebook!.lines.find((l) => l.id === id);
