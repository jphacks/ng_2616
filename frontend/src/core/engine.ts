'use client';

import {
  printSegmentLatex,
  type MathJSON,
} from '@mn/contracts/ir';
import type { Line, Meta, Notebook, Proof, Recovery, Stroke, SuggestInput, UiLang } from '@mn/contracts';
import { api, ApiCallError } from '@/core/api/client';
import { suggestBlockerOf, suggestModeOf } from '@/core/candidates/blocker';
import { getCas, type CasController } from '@/core/cas/controller';
import { composeProof, contextFingerprint, inputHash, payloadForCandidate, payloadForLine } from '@/core/cas/payload';
import type { Snapshot } from '@/core/history/history';
import { shortId, uuid } from '@/core/ids';
import { rasterizeStrokes } from '@/core/ink/raster';
import {
  anyPending,
  contextLinesFor,
  emptyDraft,
  findLine,
  hasMath,
  hasUnresolvedWrong,
  lastSettledMath,
  lineIndex,
  mathLatexOf,
  newDraftLine,
  proofOf,
} from '@/core/notebook/model';
import { getRepository } from '@/core/persistence/repo';
import { demoBinding } from '@/core/presets';
import { buildReferences } from '@/core/resources/references';
import { notebookStore as store, type Candidate, type CandidatePolicy } from '@/core/store/notebook-store';

const SUGGEST_IDLE_MS = 1200;

export interface EngineDeps {
  ownerId: string;
  lang: () => UiLang;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** Orchestrates the asynchronous Must flows on top of the store (one engine per open notebook). */
export class NotebookEngine {
  readonly sessionId = uuid();
  private cas: CasController = getCas();
  private aborts = new Map<string, AbortController>();
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private retried = new Set<string>();
  private cache = new Map<string, Proof>();
  private unsub: (() => void) | null = null;
  private disposed = false;

  constructor(private deps: EngineDeps) {
    this.unsub = this.cas.onChange((state, detail) => {
      store.getState().set('cas', { state, detail, version: this.cas.versionString });
      if (state === 'ready') {
        void this.recheckStale();
        this.scheduleSuggestion();
      }
    });
    store.getState().set('cas', { state: this.cas.status, version: this.cas.versionString });
    void this.cas.start();
  }

  dispose() {
    this.disposed = true;
    for (const a of this.aborts.values()) a.abort();
    this.aborts.clear();
    this.cancelSuggestion();
    this.unsub?.();
  }

  private get nb(): Notebook {
    return store.getState().notebook!;
  }

  private meta(lineId?: string, lineVersion?: number): Meta {
    const s = store.getState();
    return {
      request_id: uuid(),
      notebook_id: s.notebook!.id,
      client_session_id: this.sessionId,
      client_epoch: s.epoch,
      ...(lineId ? { line_id: lineId } : {}),
      ...(lineVersion !== undefined ? { line_version: lineVersion } : {}),
      context_fingerprint: contextFingerprint(s.notebook!, this.sessionId, s.epoch),
    };
  }

  private slot(key: string): AbortController {
    this.aborts.get(key)?.abort();
    const ctl = new AbortController();
    this.aborts.set(key, ctl);
    return ctl;
  }

  private abortAll() {
    for (const a of this.aborts.values()) a.abort();
    this.aborts.clear();
  }

  // ------------------------------------------------------------------ ink

  addStroke(lineId: string, stroke: Stroke) {
    const s = store.getState();
    store.getState().commit(
      'ADD_STROKE',
      (snap) => ({
        ...snap,
        activeLineId: lineId,
        lines: snap.lines.map((l) => (l.id === lineId && l.state === 'DRAFT' ? { ...l, version: l.version + 1, ink: [...l.ink, stroke] } : l)),
      }),
      lineId,
    );
    this.cancelSuggestion();
    if (s.candidate && s.candidate.state === 'READY' && s.candidate.targetLineId === lineId) {
      s.set('candidate', { ...s.candidate, state: 'HELD' });
    }
  }

  eraseStrokes(lineId: string, ids: string[]) {
    if (!ids.length) return;
    const drop = new Set(ids);
    store.getState().commit(
      'ERASE_STROKES',
      (snap) => ({ ...snap, lines: snap.lines.map((l) => (l.id === lineId && l.state === 'DRAFT' ? { ...l, version: l.version + 1, ink: l.ink.filter((st) => !drop.has(st.id)) } : l)) }),
      lineId,
    );
    this.maybeReleaseHeld(lineId);
  }

  clearDraft(lineId: string) {
    const line = findLine(this.nb, lineId);
    if (!line || line.state !== 'DRAFT' || line.ink.length === 0) return;
    store.getState().commit('CLEAR_DRAFT', (snap) => ({ ...snap, lines: snap.lines.map((l) => (l.id === lineId ? { ...l, version: l.version + 1, ink: [] } : l)) }), lineId);
    this.maybeReleaseHeld(lineId);
  }

  private maybeReleaseHeld(lineId: string) {
    const s = store.getState();
    const line = findLine(this.nb, lineId);
    if (s.candidate?.state === 'HELD' && emptyDraft(line)) s.set('candidate', { ...s.candidate, state: 'READY' });
    else if (emptyDraft(line)) this.scheduleSuggestion();
  }

  /** New line keeps the current draft and moves to a fresh one without submitting (spec §8.1). */
  newLine() {
    const s = store.getState();
    const active = s.activeLineId ? findLine(this.nb, s.activeLineId) : undefined;
    if (active && emptyDraft(active)) return;
    const draft = newDraftLine();
    s.commit('ADD_DRAFT', (snap) => {
      const idx = active ? snap.lines.findIndex((l) => l.id === active.id) : snap.lines.length - 1;
      const lines = [...snap.lines];
      lines.splice(idx + 1, 0, draft);
      return { ...snap, lines, activeLineId: draft.id };
    }, draft.id);
  }

  activate(lineId: string) {
    const line = findLine(this.nb, lineId);
    if (line?.state === 'DRAFT') store.getState().setActive(lineId);
  }

  // ------------------------------------------------------------------ confirm + recognition

  async confirmLine(lineId: string) {
    const s = store.getState();
    const line = findLine(this.nb, lineId);
    if (!line || line.state !== 'DRAFT' || line.ink.length === 0) return; // empty/duplicate confirmation is harmless
    this.cancelSuggestion();
    s.set('candidate', null);
    s.bumpEpoch();
    const next = this.nb.lines[lineIndex(this.nb, lineId) + 1];
    const draft = next && emptyDraft(next) ? next : newDraftLine();
    s.commit(
      'CONFIRM_LINE',
      (snap) => {
        const lines = snap.lines.map((l) => (l.id === lineId ? { ...l, version: l.version + 1, state: 'RECOGNIZING' as const, failure: undefined } : l));
        if (draft !== next) lines.splice(lines.findIndex((l) => l.id === lineId) + 1, 0, draft);
        return { ...snap, lines, activeLineId: draft.id };
      },
      lineId,
    );
    await this.recognize(lineId);
  }

  private async recognize(lineId: string) {
    let line = findLine(this.nb, lineId)!;
    const version = line.version;
    const image = rasterizeStrokes(line.ink);
    if (!image) return this.failLine(lineId, version, 'recognize', 'IMAGE_INVALID');
    const ctl = this.slot(`line:${lineId}`);
    const nb = this.nb;
    const prev = contextLinesFor(nb, lineId).filter(hasMath).pop();
    const userIndex = contextLinesFor(nb, lineId).filter((l) => l.source === 'user' && hasMath(l)).length;
    try {
      const result = await api.recognize(
        this.meta(lineId, version),
        {
          image,
          previous_math_latex: prev ? mathLatexOf(prev) : undefined,
          functions: nb.problem.functions ?? [],
          ui_lang: this.deps.lang(),
          prefetch: false,
          demo: demoBinding(nb),
          user_line_index: userIndex,
        },
        ctl.signal,
      );
      line = findLine(this.nb, lineId)!;
      if (!line || line.version !== version || this.disposed) return; // stale response: rejected
      if (result.segments.length === 0) return this.failLine(lineId, version, 'recognize', 'RECOGNIZE_UNREADABLE');
      const recognized: Line = { ...line, version: version + 1, state: 'VERIFYING', segments: result.segments };
      store.getState().settleLine(recognized);
      await this.verifyLine(lineId);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const code = e instanceof ApiCallError ? e.code : 'NETWORK';
      const message = e instanceof Error ? e.message : undefined;
      this.failLine(lineId, version, 'recognize', code, message);
    } finally {
      if (this.aborts.get(`line:${lineId}`) === ctl) this.aborts.delete(`line:${lineId}`);
    }
  }

  private failLine(lineId: string, version: number, stage: 'recognize' | 'verify', code: string, message?: string) {
    const line = findLine(this.nb, lineId);
    if (!line || line.version !== version) return;
    store.getState().settleLine({ ...line, version: version + 1, state: 'RECOGNIZE_FAILED', failure: { stage, code, ...(message ? { message: message.slice(0, 300) } : {}) } });
    if (code === 'AUTH_REQUIRED') store.getState().showToast(this.deps.t('toast.signInAgain'), 'error');
  }

  /** Retry keeps the same ink; verification failures re-run only the CAS (no image resubmission). */
  async retry(lineId: string) {
    const line = findLine(this.nb, lineId);
    if (!line || line.state !== 'RECOGNIZE_FAILED') return;
    if (line.failure?.stage === 'verify' && hasMath(line)) {
      store.getState().settleLine({ ...line, version: line.version + 1, state: 'VERIFYING', failure: undefined });
      await this.verifyLine(lineId);
      return;
    }
    store.getState().settleLine({ ...line, version: line.version + 1, state: 'RECOGNIZING', failure: undefined });
    await this.recognize(lineId);
  }

  /** Back to ink: a failed or wrongly-recognized line becomes an editable draft again. */
  backToInk(lineId: string) {
    store.getState().commit(
      'CONFIRM_LINE',
      (snap) => ({
        ...snap,
        activeLineId: lineId,
        lines: snap.lines.map((l) => (l.id === lineId ? { ...l, version: l.version + 1, state: 'DRAFT', segments: [], verified: undefined, failure: undefined } : l)),
      }),
      lineId,
    );
    this.abortSlot(`line:${lineId}`);
  }

  private abortSlot(key: string) {
    this.aborts.get(key)?.abort();
    this.aborts.delete(key);
  }

  // ------------------------------------------------------------------ verification

  async verifyLine(lineId: string): Promise<Proof | null> {
    if (this.cas.status !== 'ready') {
      const ok = await this.cas.start();
      if (!ok) {
        const l = findLine(this.nb, lineId);
        if (l) this.failLine(lineId, l.version, 'verify', 'CAS_UNAVAILABLE');
        return null;
      }
    }
    let line = findLine(this.nb, lineId);
    if (!line) return null;
    const version = line.version;
    const nb = this.nb;
    const payload = payloadForLine(nb, lineId);
    const casVersion = this.cas.versionString;
    const hash = inputHash(nb, payload, casVersion);
    let proof = this.cache.get(hash);
    if (!proof) {
      const out = await this.cas.verify(payload);
      line = findLine(this.nb, lineId);
      if (!line || line.version !== version || this.disposed) return null;
      if (out.kind === 'unavailable') {
        this.failLine(lineId, version, 'verify', 'CAS_UNAVAILABLE');
        return null;
      }
      proof = composeProof(out.kind === 'ok' ? out.proof : null, {
        inputHash: hash,
        mock: false,
        casVersion,
        elapsedMs: out.elapsedMs,
        timedOut: out.kind === 'timeout',
        reason: out.kind === 'timeout' ? 'TIMEOUT' : out.kind === 'error' ? 'CAS_ERROR' : undefined,
      });
      if (out.kind === 'ok') this.cache.set(hash, proof);
    }
    line = findLine(this.nb, lineId)!;
    const settled: Line = {
      ...line,
      version: line.version + 1,
      state: 'SETTLED',
      failure: undefined,
      verified: { verification_id: uuid(), input_hash: hash, proof },
    };
    store.getState().settleLine(settled);
    this.afterSettled(settled, proof);
    this.scheduleSuggestion();
    return proof;
  }

  /** Recovery bookkeeping (spec §10): wrong opens a recovery; only an ok revision resolves it. */
  private afterSettled(line: Line, proof: Proof) {
    const s = store.getState();
    const nb = this.nb;
    let recoveries = nb.recoveries;
    let lines = nb.lines;
    const root = line.recovery_root_id ?? line.id;
    const existing = recoveries.find((r) => r.root_line_id === root);
    if (line.revision_of) {
      const phase: Recovery['phase'] = proof.status === 'ok' ? 'RECOVERED' : proof.status === 'wrong' ? 'WRONG_SHOWN' : 'UNRESOLVED';
      recoveries = existing
        ? recoveries.map((r) => (r.root_line_id === root ? { ...r, current_line_id: line.id, phase, opened_at: { ...r.opened_at, ...(phase === 'RECOVERED' ? { recovered: Date.now() } : {}) } } : r))
        : [...recoveries, { root_line_id: root, current_line_id: line.id, phase, opened_at: {} }];
      if (proof.status === 'ok') {
        lines = lines.map((l) => (l.id === line.revision_of ? { ...l, version: l.version + 1, state: 'SUPERSEDED', superseded_by: line.id } : l));
      }
    } else if (proof.status === 'wrong' && !existing) {
      recoveries = [...recoveries, { root_line_id: line.id, current_line_id: line.id, phase: 'WRONG_SHOWN', opened_at: {} }];
    }
    if (recoveries !== nb.recoveries || lines !== nb.lines) {
      s.set('notebook', { ...nb, lines, recoveries });
      if (proof.status === 'ok' && line.revision_of) s.showToast(this.deps.t('toast.recovered'));
    }
  }

  /** After opening a notebook or a CAS upgrade: recheck lines whose stored input hash no longer matches. */
  async recheckStale() {
    const nb = this.nb;
    if (!nb || this.cas.status !== 'ready') return;
    for (const l of nb.lines) {
      const cur = findLine(this.nb, l.id);
      if (!cur || cur.state !== 'SETTLED' || !hasMath(cur)) continue;
      const hash = inputHash(this.nb, payloadForLine(this.nb, cur.id), this.cas.versionString);
      if (cur.verified?.input_hash === hash) {
        this.cache.set(hash, cur.verified.proof);
        continue;
      }
      store.getState().patchLine(cur.id, (x) => ({ ...x, version: x.version + 1, state: 'VERIFYING' }));
      await this.verifyLine(cur.id);
    }
  }

  // ------------------------------------------------------------------ suggestions

  cancelSuggestion() {
    if (this.suggestTimer) clearTimeout(this.suggestTimer);
    this.suggestTimer = null;
  }

  scheduleSuggestion(delay = SUGGEST_IDLE_MS) {
    this.cancelSuggestion();
    if (!this.canSuggest(false)) return;
    this.suggestTimer = setTimeout(() => void this.requestSuggestion(false), delay);
  }

  private suggestBlocker(): string | null {
    const s = store.getState();
    return suggestBlockerOf({
      notebook: s.notebook,
      casReady: this.cas.status === 'ready',
      candidate: s.candidate?.state ?? null,
      activeLine: s.notebook && s.activeLineId ? findLine(s.notebook, s.activeLineId) : undefined,
    });
  }

  canSuggest(manual: boolean): boolean {
    const b = this.suggestBlocker();
    return b === null || (manual && b === 'busy' && store.getState().candidate?.state === 'HELD');
  }

  async requestSuggestion(manual: boolean) {
    const blocker = this.suggestBlocker();
    if (blocker) {
      if (manual) {
        const key = blocker === 'wrong' ? 'toast.fixWrongFirst' : blocker === 'cas' ? 'toast.casLoading' : blocker === 'empty' ? 'toast.writeFirst' : blocker === 'writing' ? 'toast.confirmFirst' : null;
        if (key) store.getState().showToast(this.deps.t(key));
      }
      return;
    }
    const s = store.getState();
    const nb = this.nb;
    const last = lastSettledMath(nb)!;
    const lastMath = last.segments.find((seg) => seg.type === 'math');
    const mode = suggestModeOf(last);
    const draftAfter = nb.lines.slice(lineIndex(nb, last.id) + 1).find((l) => emptyDraft(l));
    const targetId = mode === 'COMPLETE_RHS' ? last.id : (draftAfter?.id ?? shortId('L'));
    const epoch = s.epoch;
    // the model always sees the current line (for COMPLETE_RHS that is the incomplete line itself);
    // the CAS checks a completion against the lines before it (verifyCandidate)
    const ctxLines = [...contextLinesFor(nb, last.id), last];
    const pending: Candidate = {
      id: uuid(),
      mode,
      contentHash: '',
      state: 'GENERATING',
      basedOnLineId: last.id,
      targetLineId: targetId,
      epoch,
      lines: [],
      policy: 'unverified',
      mock: false,
    };
    s.set('candidate', pending);
    s.set('suggesting', true);
    const ctl = this.slot('suggest');
    try {
      const recentText = ctxLines.slice(-8).map(mathLatexOf).join(' ');
      const reference = await buildReferences(this.deps.ownerId, nb.id, recentText).catch(() => []);
      const input: SuggestInput = {
        context: {
          problem: nb.problem,
          lines: ctxLines.filter((l) => l.segments.length > 0).slice(-64).map((l) => ({ id: l.id, role: l.role, source: l.source, status: proofOf(l)?.status, segments: l.segments })),
        },
        mode,
        based_on_line_id: last.id,
        target_line_id: targetId,
        ...(mode === 'COMPLETE_RHS' && lastMath?.type === 'math' ? { lhs_expr: (lastMath.expr as MathJSON[])[1] as MathJSON } : {}),
        rejected_hashes: s.rejectedHashes.slice(-64),
        rejected_latex: s.rejectedLatex.slice(-16),
        ...(reference.length ? { reference } : {}),
        ui_lang: this.deps.lang(),
        demo: demoBinding(nb),
      };
      const res = await api.suggest(this.meta(last.id, last.version), input, ctl.signal);
      if (this.isStale(epoch, last)) return;
      if (res.state === 'NONE' || !res.candidate) {
        store.getState().set('candidate', null);
        if (manual) store.getState().showToast(this.deps.t('toast.noSuggestion'));
        return;
      }
      store.getState().set('candidate', { ...pending, state: 'VERIFYING', id: res.candidate.id, contentHash: res.candidate.content_hash, mock: res.mock });
      await this.verifyCandidate(res.candidate, pending, ctxLines, manual);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (store.getState().candidate?.id === pending.id || store.getState().candidate?.state === 'GENERATING') store.getState().set('candidate', null);
      if (manual) store.getState().showToast(this.deps.t('toast.suggestFailed'), 'error');
      console.warn('[suggest]', e);
    } finally {
      store.getState().set('suggesting', false);
    }
  }

  private isStale(epoch: number, basedOn: Line): boolean {
    const s = store.getState();
    const cur = s.notebook ? findLine(s.notebook, basedOn.id) : undefined;
    return this.disposed || s.epoch !== epoch || !cur || cur.version !== basedOn.version;
  }

  private async verifyCandidate(
    draft: NonNullable<Awaited<ReturnType<typeof api.suggest>>['candidate']>,
    pending: Candidate,
    ctxLines: Line[],
    manual: boolean,
  ) {
    const nb = this.nb;
    const basedOn = findLine(nb, pending.basedOnLineId)!;
    const verifiedLines: Candidate['lines'] = [];
    const chain: Line[] = [...ctxLines];
    let policy: CandidatePolicy = 'verified';
    for (const cl of draft.lines) {
      const target = { ...cl.target };
      const payload = payloadForCandidate(nb, pending.mode === 'COMPLETE_RHS' ? contextLinesFor(nb, basedOn.id) : chain, target);
      const casVersion = this.cas.versionString;
      const hash = inputHash(nb, payload, casVersion);
      const out = await this.cas.verify(payload);
      if (this.isStale(pending.epoch, basedOn)) return;
      if (out.kind === 'unavailable') {
        store.getState().set('candidate', null);
        return;
      }
      const proof = composeProof(out.kind === 'ok' ? out.proof : null, {
        inputHash: hash,
        mock: draft.lines.length > 0 && false,
        casVersion,
        elapsedMs: out.elapsedMs,
        timedOut: out.kind === 'timeout',
        reason: out.kind === 'timeout' ? 'TIMEOUT' : out.kind === 'error' ? 'CAS_ERROR' : undefined,
      });
      if (proof.status === 'wrong') {
        this.recordCheckerRejection(draft, pending, cl.segments, proof);
        const key = `${basedOn.id}:${basedOn.version}`;
        if (!this.retried.has(key)) {
          this.retried.add(key);
          store.getState().set('candidate', null);
          void this.requestSuggestion(manual);
        } else {
          store.getState().set('candidate', null);
        }
        return;
      }
      if (proof.status === 'unknown') policy = 'unverified';
      else if (proof.status === 'none' && policy === 'verified') policy = 'assumption';
      const verified = { verification_id: uuid(), input_hash: hash, proof };
      verifiedLines.push({ target, segments: cl.segments, verified });
      chain.push({ id: target.id, version: 1, source: 'ai', role: target.role, state: 'SETTLED', ink: [], segments: cl.segments, verified });
    }
    const s = store.getState();
    const active = s.activeLineId ? findLine(this.nb, s.activeLineId) : undefined;
    const writing = active && active.state === 'DRAFT' && active.ink.length > 0;
    s.set('candidate', { ...pending, id: draft.id, contentHash: draft.content_hash, lines: verifiedLines, policy, state: writing ? 'HELD' : 'READY' });
  }

  private recordCheckerRejection(draft: { id: string; content_hash: string }, pending: Candidate, segments: Line['segments'], proof: Proof) {
    const s = store.getState();
    const latex = segments.map((seg) => (seg.type === 'math' ? printSegmentLatex(seg.expr, seg.notation) : seg.text)).join(' ');
    s.set('rejectedHashes', [...s.rejectedHashes, draft.content_hash]);
    s.set('rejectedLatex', [...s.rejectedLatex, latex]);
    s.set('rejection', { id: draft.id, segments, proof, basedOnLineId: pending.basedOnLineId });
  }

  /** Returns 'confirm' when an unverified suggestion needs the extra confirmation (ADR 0003). */
  adopt(confirmUnverified = false): 'adopted' | 'confirm' | 'stale' | 'none' {
    const s = store.getState();
    const c = s.candidate;
    if (!c || c.state !== 'READY') return 'none';
    if (c.policy === 'unverified' && !confirmUnverified) return 'confirm';
    const nb = this.nb;
    const basedOn = findLine(nb, c.basedOnLineId);
    if (!basedOn || c.epoch !== s.epoch || hasUnresolvedWrong(nb)) {
      s.set('candidate', null);
      return 'stale';
    }
    const first = c.lines[0]!;
    // adoption re-checks the verification input against the current context (spec §11)
    const ctx = c.mode === 'COMPLETE_RHS' ? contextLinesFor(nb, basedOn.id) : [...contextLinesFor(nb, basedOn.id), basedOn];
    const recheck = inputHash(nb, payloadForCandidate(nb, ctx, first.target), this.cas.versionString);
    if (recheck !== first.verified?.input_hash) {
      s.set('candidate', null);
      return 'stale';
    }
    const draft = newDraftLine();
    s.commit(
      'ADOPT_CANDIDATE',
      (snap): Snapshot => {
        const origin = { candidate_id: c.id, mode: c.mode, ...(c.policy === 'unverified' ? { unverified_adoption: true } : {}) };
        if (c.mode === 'COMPLETE_RHS') {
          return {
            ...snap,
            lines: snap.lines.map((l) => (l.id === c.targetLineId ? { ...l, version: l.version + 1, segments: first.segments, verified: first.verified, ai_origin: origin, source: l.source } : l)),
          };
        }
        const lines = [...snap.lines];
        const existing = lines.findIndex((l) => l.id === c.targetLineId);
        const aiLine: Line = {
          id: c.targetLineId,
          version: (existing >= 0 ? lines[existing]!.version : 0) + 1,
          source: 'ai',
          role: first.target.role,
          state: 'SETTLED',
          ink: [],
          segments: first.segments,
          verified: first.verified,
          ai_origin: origin,
        };
        let at: number;
        if (existing >= 0) {
          lines[existing] = aiLine;
          at = existing;
        } else {
          at = lines.findIndex((l) => l.id === c.basedOnLineId) + 1;
          lines.splice(at, 0, aiLine);
        }
        const following = lines[at + 1];
        if (following && emptyDraft(following)) return { ...snap, lines, activeLineId: following.id };
        lines.splice(at + 1, 0, draft);
        return { ...snap, lines, activeLineId: draft.id };
      },
      c.targetLineId,
    );
    s.set('candidate', null);
    s.set('rejection', null);
    s.set('rejectedHashes', []);
    s.set('rejectedLatex', []);
    this.scheduleSuggestion(500);
    return 'adopted';
  }

  /** Rejection changes no line and keeps the same candidate from reappearing in this context. */
  reject() {
    const s = store.getState();
    const c = s.candidate;
    if (!c) return;
    const latex = c.lines.map((l) => l.segments.map((seg) => (seg.type === 'math' ? seg.latex : seg.text)).join(' ')).join(' ; ');
    s.set('rejectedHashes', [...s.rejectedHashes, c.contentHash]);
    s.set('rejectedLatex', [...s.rejectedLatex, latex]);
    s.set('candidate', null);
    this.abortSlot('suggest');
  }

  // ------------------------------------------------------------------ recovery

  openLine(lineId: string) {
    store.getState().set('sheet', { kind: 'line', lineId });
  }

  markRecovery(rootId: string, stage: 'evidence' | 'hint1' | 'hint2') {
    const s = store.getState();
    const nb = this.nb;
    const phase: Recovery['phase'] = stage === 'evidence' ? 'EVIDENCE_OPEN' : stage === 'hint1' ? 'HINT_FOCUS' : 'HINT_LOCATE';
    const recoveries = nb.recoveries.map((r) =>
      r.root_line_id === rootId && r.phase !== 'RECOVERED' ? { ...r, phase: ['REVISING', 'REVERIFYING'].includes(r.phase) ? r.phase : phase, opened_at: { ...r.opened_at, [stage]: r.opened_at[stage] ?? Date.now() } } : r,
    );
    s.set('notebook', { ...nb, recoveries });
  }

  /** Revise creates a draft directly beneath the source, checked against the source's parent. */
  startRevision(lineId: string) {
    const s = store.getState();
    const source = findLine(this.nb, lineId);
    if (!source) return;
    const root = source.recovery_root_id ?? source.id;
    const draft: Line = { ...newDraftLine(), revision_of: source.id, recovery_root_id: root };
    s.commit(
      'START_REVISION',
      (snap) => {
        const lines = [...snap.lines];
        lines.splice(lines.findIndex((l) => l.id === source.id) + 1, 0, draft);
        const recoveries = snap.recoveries.some((r) => r.root_line_id === root)
          ? snap.recoveries.map((r) => (r.root_line_id === root ? { ...r, phase: 'REVISING' as const, opened_at: { ...r.opened_at, revise: Date.now() } } : r))
          : [...snap.recoveries, { root_line_id: root, current_line_id: source.id, phase: 'REVISING' as const, opened_at: { revise: Date.now() } }];
        return { ...snap, lines, recoveries, activeLineId: draft.id };
      },
      draft.id,
    );
    s.set('sheet', null);
    s.set('candidate', null);
    s.bumpEpoch();
  }

  // ------------------------------------------------------------------ history

  undo() {
    this.abortAll();
    this.cancelSuggestion();
    if (store.getState().undo()) this.scheduleSuggestion();
  }

  redo() {
    this.abortAll();
    this.cancelSuggestion();
    if (store.getState().redo()) this.scheduleSuggestion();
  }

  editProblem(problem: Notebook['problem']) {
    const s = store.getState();
    if (anyPending(this.nb)) {
      s.showToast(this.deps.t('toast.waitForChecks'));
      return;
    }
    s.commit('EDIT_PROBLEM', (snap) => ({ ...snap, problem }));
    s.bumpEpoch();
    s.set('candidate', null);
    void this.recheckStale();
  }

  rename(title: string) {
    const nb = this.nb;
    const clean = title.trim().slice(0, 200) || nb.title;
    store.getState().set('notebook', { ...nb, title: clean });
    store.getState().set('dirty', true);
  }

  // ------------------------------------------------------------------ resources

  /** Lazy OCR for a resource page without a text layer (spec §15.2: only when opened). */
  async ocrPage(image: { mime: 'image/jpeg' | 'image/png'; data: string }): Promise<string | null> {
    try {
      const res = await api.ocrPage(this.meta(), { image, ui_lang: this.deps.lang() });
      return res.text;
    } catch (e) {
      console.warn('[ocr]', e);
      return null;
    }
  }

  // ------------------------------------------------------------------ persistence

  async save(): Promise<boolean> {
    const s = store.getState();
    const nb = this.nb;
    s.set('saveState', 'saving');
    const repo = getRepository(this.deps.ownerId);
    try {
      const res = await repo.save(nb, s.cloudRevision);
      if (res.ok) {
        // edits made during the save stay dirty
        const stillSame = store.getState().notebook === nb;
        store.getState().set('cloudRevision', res.revision);
        store.getState().set('saveState', 'saved');
        if (stillSame) store.getState().set('dirty', false);
        return true;
      }
      store.getState().set('saveState', res.reason === 'conflict' ? 'conflict' : 'error');
      store.getState().set('saveError', res.message ?? res.reason);
      return false;
    } catch (e) {
      store.getState().set('saveState', 'error');
      store.getState().set('saveError', e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** "Save as another notebook" after a conflict: new id, revision starts at 1. */
  async saveAsCopy(): Promise<string | null> {
    const s = store.getState();
    const copy: Notebook = { ...this.nb, id: uuid(), title: `${this.nb.title} (2)` };
    const res = await getRepository(this.deps.ownerId).save(copy, null);
    if (!res.ok) return null;
    s.load(copy, res.revision);
    return copy.id;
  }
}
