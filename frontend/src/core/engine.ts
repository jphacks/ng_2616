'use client';

import {
  printSegmentLatex,
  type MathJSON,
} from '@mn/contracts/ir';
import {
  declaredFunctions,
  leanOf,
  routeOf,
  theoremOf,
  withLineLean,
  withTheorem,
  type CheckerFeedback,
  type LeanCheckResult,
  type Line,
  type LineLean,
  type Meta,
  type Notebook,
  type Proof,
  type Recovery,
  type Stroke,
  type SuggestInput,
  type UiLang,
} from '@mn/contracts';
import { api, ApiCallError } from '@/core/api/client';
import { blockerToastKey, continuable, hasOwnLine, suggestBaseLine, suggestModeOf, type SuggestBlocker } from '@/core/candidates/blocker';
import { abortOnEpochChange } from '@/core/candidates/epoch';
import { addRejection, isRecordable, rejectionKey, rejectionsFor } from '@/core/candidates/rejection';
import { matchesSlot, suggestFingerprint, type SlotMeta } from '@/core/candidates/slot';
import { getCas, type CasController } from '@/core/cas/controller';
import { composeProof, contextFingerprint, inputHash, payloadForCandidate, payloadForLine, semanticHash } from '@/core/cas/payload';
import { leanContextHash, leanEnabled, leanInput, needsLean } from '@/core/lean/route';
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
  isGiven,
  lineIndex,
  mathLatexOf,
  newDraftLine,
  proofOf,
  withDeclarations,
} from '@/core/notebook/model';
import { Autosaver } from '@/core/persistence/autosave';
import { clearPending, openOutbox, putPending, putPendingNow } from '@/core/persistence/outbox';
import { getRepository } from '@/core/persistence/repo';
import { demoBinding } from '@/core/presets';
import { buildReferences } from '@/core/resources/references';
import { copyNotebookResources } from '@/core/resources/service';
import { notebookStore as store, type Candidate, type CandidatePolicy } from '@/core/store/notebook-store';
import { SUGGEST_ATTEMPTS, checkerFeedback, runAttempts, type Attempt } from '@/core/suggest/attempts';

const SUGGEST_IDLE_MS = 1200;
/** A hidden (HELD) suggestion comes back after this long without a new stroke (R14; same value as C-01's pen-up wait). */
export const HELD_QUIET_MS = 1200;

const segmentsLatex = (segments: Line['segments']) => segments.map((seg) => (seg.type === 'math' ? printSegmentLatex(seg.expr, seg.notation) : seg.text)).join(' ');

export interface EngineDeps {
  ownerId: string;
  lang: () => UiLang;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** The parts of the CAS controller and API client the engine uses; tests pass fakes for them. */
export type CasPort = Pick<CasController, 'status' | 'versionString' | 'onChange' | 'start' | 'verify'>;
export type ApiPort = Pick<typeof api, 'suggest' | 'recognize' | 'ocrPage'> & Partial<Pick<typeof api, 'leanCheck'>>;

/** Optional replacements for the real CAS worker and API client (omitted: the app behaves as before). */
export interface EngineOverrides {
  cas?: CasPort;
  api?: ApiPort;
}

/** Orchestrates the asynchronous Must flows on top of the store (one engine per open notebook). */
export class NotebookEngine {
  readonly sessionId = uuid();
  private cas: CasPort;
  private api: ApiPort;
  private aborts = new Map<string, AbortController>();
  private suggestTimer: ReturnType<typeof setTimeout> | null = null;
  private heldTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStrokeAt = 0;
  /** the active suggestion request: results are applied only if they still match it (spec §7.3) */
  private suggestSlot: SlotMeta | null = null;
  private retried = new Set<string>();
  private cache = new Map<string, Proof>();
  private unsub: (() => void) | null = null;
  private disposed = false;
  private autosave: Autosaver;
  private offAutosave: () => void;

  constructor(private deps: EngineDeps, overrides: EngineOverrides = {}) {
    this.cas = overrides.cas ?? getCas();
    this.api = overrides.api ?? api;
    this.autosave = new Autosaver({
      getState: () => store.getState(),
      subscribe: (fn) => store.subscribe(fn),
      saveCloud: (nb, rev) => getRepository(deps.ownerId).save(nb, rev),
      saveLocal: (nb, rev) => putPending(deps.ownerId, nb, rev),
      saveLocalNow: (nb, rev) => putPendingNow(deps.ownerId, nb, rev),
      clearLocal: (id) => clearPending(deps.ownerId, id),
      onSaved: (nb, rev) => store.getState().markSaved(nb, rev),
      onStatus: (state, message) => {
        const s = store.getState();
        if (s.saveState !== state) s.set('saveState', state);
        if (s.saveError !== message) s.set('saveError', message);
      },
    });
    openOutbox(deps.ownerId);
    this.autosave.start();
    this.offAutosave = watchPage(this.autosave);
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
    // leaving the notebook: send what is left; the outbox keeps it if that fails
    void this.autosave.close();
    this.offAutosave();
    for (const a of this.aborts.values()) a.abort();
    this.aborts.clear();
    this.cancelSuggestion();
    if (this.heldTimer) clearTimeout(this.heldTimer);
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
    // writing on any draft line hides a ready suggestion (spec §11), not only on the line it is for
    if (s.candidate && s.candidate.state === 'READY' && findLine(this.nb, lineId)?.state === 'DRAFT') {
      s.set('candidate', { ...s.candidate, state: 'HELD' });
    }
    this.restartHeldTimer();
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

  /** After every stroke the pen is up: count the quiet time again from now (R14). */
  private restartHeldTimer() {
    this.lastStrokeAt = Date.now();
    this.armHeldTimer();
  }

  /** Wait out the rest of the quiet time since the last stroke, then try to bring a HELD suggestion back. */
  private armHeldTimer() {
    if (this.heldTimer) clearTimeout(this.heldTimer);
    const wait = Math.max(0, HELD_QUIET_MS - (Date.now() - this.lastStrokeAt));
    this.heldTimer = setTimeout(() => {
      this.heldTimer = null;
      this.releaseHeldAfterQuiet();
    }, wait);
  }

  /**
   * HELD -> READY once no stroke has come for HELD_QUIET_MS and the context is still the one the suggestion was made
   * in (same slot: request, epoch, line version, suggestFingerprint). If the context changed it is STALE and dropped.
   */
  private releaseHeldAfterQuiet() {
    const s = store.getState();
    const c = s.candidate;
    if (!c || c.state !== 'HELD' || this.disposed) return;
    if (Date.now() - this.lastStrokeAt < HELD_QUIET_MS) return this.armHeldTimer();
    // a NEXT_STEP suggestion lands on its reserved draft line: while that very draft holds the student's ink, showing it
    // would offer to replace their writing, so it stays hidden until the draft is emptied or confirmed
    const target = findLine(this.nb, c.targetLineId);
    if (c.mode === 'NEXT_STEP' && target?.state === 'DRAFT' && target.ink.length > 0) return;
    if (!this.suggestSlot || this.isStale(this.suggestSlot)) {
      s.set('candidate', null);
      return;
    }
    s.set('candidate', { ...c, state: 'READY' });
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
    const userIndex = contextLinesFor(nb, lineId).filter((l) => l.source === 'user' && !isGiven(l) && hasMath(l)).length;
    try {
      const result = await this.api.recognize(
        this.meta(lineId, version),
        {
          image,
          previous_math_latex: prev ? mathLatexOf(prev) : undefined,
          functions: declaredFunctions(nb.lines),
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
      const recognized: Line = {
        ...line,
        version: version + 1,
        state: 'VERIFYING',
        segments: result.segments,
        // the checker the model chose (ADR 0008); a new reading has no Lean verdict yet
        extensions: { ...withoutReading(line.extensions), ...(result.route ? { route: result.route } : {}) },
      };
      store.getState().settleLine(recognized);
      const reread = this.syncDeclarations();
      await this.verifyLine(lineId);
      if (reread) void this.recheckStale();
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
        lines: snap.lines.map((l) =>
          l.id === lineId ? { ...l, version: l.version + 1, state: 'DRAFT', segments: [], verified: undefined, failure: undefined, extensions: withoutReading(l.extensions) } : l,
        ),
      }),
      lineId,
    );
    this.abortSlot(`line:${lineId}`);
    this.abortSlot(`lean:${lineId}`);
    if (this.syncDeclarations()) void this.recheckStale();
  }

  /**
   * A function declaration holds for the whole page, so lines written above it are read again
   * when the declared functions change (outside history: undo restores lines read consistently).
   * True when any line changed; lines already being checked are checked again.
   */
  private syncDeclarations(): boolean {
    const s = store.getState();
    const nb = s.notebook;
    if (!nb) return false;
    const lines = withDeclarations(nb.lines);
    if (lines === nb.lines) return false;
    s.set('notebook', { ...nb, lines });
    s.set('dirty', true);
    for (const [i, l] of lines.entries()) {
      if (l !== nb.lines[i] && l.state === 'VERIFYING') void this.verifyLine(l.id);
    }
    return true;
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
    if (needsLean(this.nb, settled)) void this.maybeCheckLean(lineId);
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
    if (!store.getState().notebook) return;
    this.syncDeclarations();
    const nb = this.nb;
    if (this.cas.status !== 'ready') return;
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
    // proof lines whose context changed are checked with Lean again (unchanged ones keep their verdict)
    for (const l of this.nb.lines) {
      const cur = findLine(this.nb, l.id);
      if (cur && needsLean(this.nb, cur)) await this.maybeCheckLean(cur.id);
    }
  }

  // ------------------------------------------------------------------ Lean (ADR 0008)

  private setLeanPending(lineId: string, on: boolean) {
    const s = store.getState();
    const next = { ...s.leanPending };
    if (on) next[lineId] = true;
    else delete next[lineId];
    s.set('leanPending', next);
  }

  /** Checks a proof line with Lean unless its verdict was made in this very context. */
  async maybeCheckLean(lineId: string) {
    const nb = this.nb;
    const line = findLine(nb, lineId);
    if (!line || store.getState().leanPending[lineId] || !needsLean(nb, line)) return;
    const lean = leanOf(line);
    if (lean?.proof && lean.context_hash === leanContextHash(leanInput(nb, line, this.deps.lang()))) return;
    await this.checkLean(lineId);
  }

  /** "Check again": translates this line afresh and asks Lean again. */
  recheckLean(lineId: string) {
    return this.checkLean(lineId, { retranslate: true });
  }

  private async checkLean(lineId: string, opts: { retranslate?: boolean } = {}) {
    if (!this.api.leanCheck) return;
    const nb = this.nb;
    const line = findLine(nb, lineId);
    if (!line || !needsLean(nb, line)) return;
    const version = line.version;
    const input = leanInput(nb, line, this.deps.lang(), opts);
    const hash = leanContextHash(input);
    const ctl = this.slot(`lean:${lineId}`);
    this.setLeanPending(lineId, true);
    let res: LeanCheckResult;
    try {
      res = await this.api.leanCheck(this.meta(lineId, version), input, ctl.signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      res = { state: 'unavailable', scope: 'theorem', steps: [], attempts: 0, mock: false, message: e instanceof ApiCallError ? e.code : 'NETWORK' };
    } finally {
      if (this.aborts.get(`lean:${lineId}`) === ctl) {
        this.aborts.delete(`lean:${lineId}`);
        this.setLeanPending(lineId, false);
      }
    }
    if (this.disposed) return;
    const cur = findLine(this.nb, lineId);
    // stale unless the line and every proof line above it are still the ones Lean saw
    if (!cur || cur.version !== version || leanContextHash(leanInput(this.nb, cur, this.deps.lang())) !== hash) return;
    this.applyLean(res, lineId, hash);
    this.scheduleSuggestion();
  }

  /** The verdict for `targetId`, plus the translations this check made for earlier lines that had none. */
  private applyLean(res: LeanCheckResult, targetId: string, hash: string | null): LineLean | undefined {
    const s = store.getState();
    this.keepTranslations(res, targetId);
    const target = findLine(this.nb, targetId);
    const verdict = leanVerdict(res, targetId, target ? leanOf(target)?.tactic : undefined, hash);
    if (target) s.annotateLine(withLineLean(target, verdict));
    if (res.theorem && res.theorem.statement !== theoremOf(this.nb)?.statement) {
      s.set('notebook', withTheorem(this.nb, res.theorem));
      s.set('dirty', true);
    }
    return verdict;
  }

  /** Earlier lines keep the tactic a check used for them, so later checks run the same proof. */
  private keepTranslations(res: LeanCheckResult, targetId: string) {
    if (res.scope !== 'theorem') return;
    for (const st of res.steps) {
      if (st.line_id === targetId) continue;
      const l = findLine(this.nb, st.line_id);
      if (l && leanOf(l)?.tactic === undefined) store.getState().annotateLine(withLineLean(l, { tactic: st.tactic }));
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

  private suggestBlocker(): SuggestBlocker | null {
    const s = store.getState();
    const nb = s.notebook;
    if (!nb) return 'none';
    if (this.cas.status !== 'ready') return 'cas';
    if (anyPending(nb) || Object.keys(s.leanPending).length > 0) return 'pending';
    if (hasUnresolvedWrong(nb)) return 'wrong';
    const last = suggestBaseLine(nb);
    // a template's given lines alone do not start suggestions: the student writes first
    if (!last || !hasOwnLine(nb)) return 'empty';
    const incomplete = proofOf(last)?.reason === 'INCOMPLETE';
    if (!incomplete && !continuable(last)) return 'cannot-continue';
    if (s.candidate && ['GENERATING', 'VERIFYING', 'READY', 'HELD'].includes(s.candidate.state)) return 'busy';
    const active = s.activeLineId ? findLine(nb, s.activeLineId) : undefined;
    if (active && active.state === 'DRAFT' && active.ink.length > 0) return 'writing';
    return null;
  }

  /** True when pressing the suggest button would start a request (the same rules as the automatic start). */
  canSuggest(_manual = false): boolean {
    return this.suggestBlocker() === null;
  }

  async requestSuggestion(manual: boolean) {
    const blocker = this.suggestBlocker();
    if (blocker) {
      if (manual) {
        const key = blockerToastKey(blocker, store.getState().candidate?.state ?? null);
        if (key) store.getState().showToast(this.deps.t(key));
      }
      return;
    }
    const s = store.getState();
    const nb = this.nb;
    const last = suggestBaseLine(nb)!;
    const lastMath = last.segments.find((seg) => seg.type === 'math');
    const mode = suggestModeOf(last);
    const draftAfter = nb.lines.slice(lineIndex(nb, last.id) + 1).find((l) => emptyDraft(l));
    const targetId = mode === 'COMPLETE_RHS' ? last.id : (draftAfter?.id ?? shortId('L'));
    const epoch = s.epoch;
    // the model always sees the current line (for COMPLETE_RHS that is the incomplete line itself);
    // the CAS checks a completion against the lines before it (verifyCandidate)
    const ctxLines = [...contextLinesFor(nb, last.id), last];
    // rejections are remembered per context: the same notebook content, mode and kind of target (spec §7.3)
    const rejectKey = rejectionKey(semanticHash(nb, payloadForCandidate(nb, ctxLines, { id: targetId, role: 'step', segments: [] })), mode);
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
      rejectKey,
    };
    s.set('candidate', pending);
    s.set('suggesting', true);
    const ctl = this.slot('suggest');
    const slot = this.slotFor(uuid(), last, ctxLines);
    this.suggestSlot = slot;
    // any epoch bump (confirm, Undo/Redo, revision, problem edit, notebook switch) cancels this request
    const stopWatching = abortOnEpochChange(store, ctl);
    // a later request owns the slot (and any candidate in progress) once it has started
    const superseded = () => {
      const cur = this.aborts.get('suggest');
      return !!cur && cur !== ctl;
    };
    // ending without a candidate to show: drop this request's "generating"/"checking" placeholder,
    // or it would stay on the page and block every later suggestion as busy
    const release = () => {
      const c = store.getState().candidate;
      if (!superseded() && c && (c.state === 'GENERATING' || c.state === 'VERIFYING')) store.getState().set('candidate', null);
    };
    try {
      const recentText = ctxLines.slice(-8).map(mathLatexOf).join(' ');
      const reference = await buildReferences(this.deps.ownerId, nb.id, recentText).catch(() => []);
      const base: Omit<SuggestInput, 'rejected_hashes'> = {
        context: {
          functions: declaredFunctions(nb.lines),
          lines: ctxLines
            .filter((l) => l.segments.length > 0)
            .slice(-64)
            .map((l) => {
              const step = leanOf(l)?.step;
              return { id: l.id, role: l.role, source: l.source, status: proofOf(l)?.status, segments: l.segments, ...(leanEnabled() ? { route: routeOf(l), ...(step ? { lean: step } : {}) } : {}) };
            }),
        },
        mode,
        based_on_line_id: last.id,
        target_line_id: targetId,
        ...(mode === 'COMPLETE_RHS' && lastMath?.type === 'math' ? { lhs_expr: (lastMath.expr as MathJSON[])[1] as MathJSON } : {}),

        ...(reference.length ? { reference } : {}),
        ui_lang: this.deps.lang(),
        demo: demoBinding(nb),
      };
      const result = await runAttempts<Candidate>(SUGGEST_ATTEMPTS, async (feedback, tried) => {
        const cur = store.getState();
        // what was rejected in this context (by the student or the checker), read again on every attempt
        const rejected = rejectionsFor(cur.rejections, rejectKey);
        // checker rejections travel as feedback (with the reason), so list them only once
        const fed = new Set(feedback.map((f) => f.latex));
        const input: SuggestInput = {
          ...base,
          rejected_hashes: [...new Set([...rejected.hashes, ...tried])].slice(-64),
          rejected_latex: rejected.latex.filter((l) => !fed.has(l)).slice(-16),
          ...(feedback.length ? { checker_feedback: feedback } : {}),
        };
        if (feedback.length) cur.set('candidate', pending);
        const res = await this.api.suggest(this.meta(last.id, last.version), input, ctl.signal);
        // stale unless the whole context still matches: epoch, the line's version and the lines it was made from
        if (this.isStale(slot)) return { kind: 'stale' };
        if (res.state === 'NONE' || !res.candidate) return res.reason === 'REJECTED_BEFORE' || res.reason === 'DUPLICATE' ? { kind: 'repeat' } : { kind: 'none' };
        store.getState().set('candidate', { ...pending, state: 'VERIFYING', id: res.candidate.id, contentHash: res.candidate.content_hash, mock: res.mock });
        return this.verifyCandidate(res.candidate, pending, ctxLines, slot, ctl.signal);
      });
      if (result.kind === 'stale') {
        release();
        if (!this.disposed) this.scheduleSuggestion();
        return;
      }
      if (result.kind === 'show') {
        const cur = store.getState();
        const active = cur.activeLineId ? findLine(this.nb, cur.activeLineId) : undefined;
        const writing = active && active.state === 'DRAFT' && active.ink.length > 0;
        cur.set('candidate', { ...result.candidate, state: writing ? 'HELD' : 'READY' });
        if (writing) this.armHeldTimer();
        return;
      }
      release();
      // after checker rejections the rejected-suggestion marker explains the empty result
      if (manual && result.rejected === 0) store.getState().showToast(this.deps.t('toast.noSuggestion'));
    } catch (e) {
      release();
      if ((e as Error).name === 'AbortError') return this.discard(pending);
      if (manual) store.getState().showToast(this.deps.t('toast.suggestFailed'), 'error');
      console.warn('[suggest]', e);
    } finally {
      stopWatching();
      if (!superseded()) {
        this.aborts.delete('suggest');
        store.getState().set('suggesting', false);
      }
    }
  }

  /** The slot of a suggestion request made now: what its result has to carry to be applied later. */
  private slotFor(requestId: string, basedOn: Line, ctxLines: readonly Line[]): SlotMeta {
    const s = store.getState();
    const nb = s.notebook!;
    return {
      request_id: requestId,
      notebook_id: nb.id,
      client_session_id: this.sessionId,
      client_epoch: s.epoch,
      line_id: basedOn.id,
      line_version: basedOn.version,
      context_fingerprint: suggestFingerprint({ notebookId: nb.id, problem: (nb as { problem?: unknown }).problem ?? null, lines: ctxLines, sessionId: this.sessionId, epoch: s.epoch }),
    };
  }

  /** A result is stale unless it carries all seven fields of what the active request would carry now. */
  private isStale(slot: SlotMeta): boolean {
    const nb = store.getState().notebook;
    const cur = nb ? findLine(nb, slot.line_id!) : undefined;
    if (this.disposed || !nb || !cur || this.suggestSlot?.request_id !== slot.request_id) return true;
    return !matchesSlot(this.slotFor(slot.request_id, cur, [...contextLinesFor(nb, cur.id), cur]), slot);
  }

  /** Drop a candidate that this request created, unless a newer request has already replaced it. */
  private discard(pending: Candidate, draftId?: string) {
    const c = store.getState().candidate;
    if (c && (c.id === pending.id || c.id === draftId)) store.getState().set('candidate', null);
  }

  private async verifyCandidate(
    draft: NonNullable<Awaited<ReturnType<typeof api.suggest>>['candidate']>,
    pending: Candidate,
    ctxLines: Line[],
    slot: SlotMeta,
    signal?: AbortSignal,
  ): Promise<Attempt<Candidate>> {
    const nb = this.nb;
    const basedOn = findLine(nb, pending.basedOnLineId)!;
    const verifiedLines: Candidate['lines'] = [];
    const chain: Line[] = [...ctxLines];
    let policy: CandidatePolicy = 'verified';
    for (const cl of draft.lines) {
      const target = { ...cl.target };
      const payload = pending.mode === 'COMPLETE_RHS' ? payloadForCandidate(nb, contextLinesFor(nb, basedOn.id), target, 'identity') : payloadForCandidate(nb, chain, target);
      const casVersion = this.cas.versionString;
      const hash = inputHash(nb, payload, casVersion);
      const out = await this.cas.verify(payload);
      if (this.isStale(slot)) return { kind: 'stale' };
      if (out.kind === 'unavailable') {
        store.getState().set('candidate', null);
        return { kind: 'stale' };
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
        return { kind: 'wrong', hash: draft.content_hash, feedback: checkerFeedback(segmentsLatex(cl.segments), proof) };
      }
      const verified = { verification_id: uuid(), input_hash: hash, proof };
      const probe: Line = { id: target.id, version: 1, source: 'ai', role: target.role, state: 'SETTLED', ink: [], segments: cl.segments, verified };
      if (cl.route === 'lean' && leanEnabled() && this.api.leanCheck) {
        // a proof step: Lean, not the CAS, says whether the model got it right (ADR 0008)
        const lean = await this.leanCandidate({ ...probe, extensions: { route: 'lean' } }, basedOn, slot, signal);
        if (lean.kind === 'stale') return lean;
        if (lean.kind === 'rejected') return { kind: 'wrong', hash: draft.content_hash, feedback: lean.feedback };
        if (lean.verdict?.step !== 'ok' && policy === 'verified') policy = 'unverified';
        const extensions = { route: 'lean', ...(lean.verdict ? { lean: lean.verdict } : {}) };
        verifiedLines.push({ target, segments: cl.segments, verified, extensions });
        chain.push({ ...probe, extensions });
        continue;
      }
      if (proof.status === 'unknown') policy = 'unverified';
      else if (proof.status === 'none' && policy === 'verified') policy = 'assumption';
      verifiedLines.push({ target, segments: cl.segments, verified });
      chain.push(probe);
    }
    return { kind: 'ready', candidate: { ...pending, id: draft.id, contentHash: draft.content_hash, lines: verifiedLines, policy } };
  }

  /**
   * Lean's check of a suggested proof step, as if it were written after `basedOn`. A step Lean
   * refuses is retried with Lean's messages; an unreachable Lean leaves the step unverified.
   */
  private async leanCandidate(
    probe: Line,
    basedOn: Line,
    slot: SlotMeta,
    signal?: AbortSignal,
  ): Promise<{ kind: 'stale' } | { kind: 'rejected'; feedback: CheckerFeedback } | { kind: 'checked'; verdict?: LineLean }> {
    const nb = this.nb;
    const lines = nb.lines.filter((l) => l.id !== probe.id);
    lines.splice(lines.findIndex((l) => l.id === basedOn.id) + 1, 0, probe);
    const view: Notebook = { ...nb, lines };
    const input = leanInput(view, probe, this.deps.lang(), { candidate: true });
    let res: LeanCheckResult;
    try {
      res = await this.api.leanCheck!(this.meta(basedOn.id, basedOn.version), input, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { kind: 'stale' };
      return { kind: 'checked' };
    }
    if (this.isStale(slot)) return { kind: 'stale' };
    this.keepTranslations(res, probe.id);
    if (res.theorem && !theoremOf(this.nb)) {
      store.getState().set('notebook', withTheorem(this.nb, res.theorem));
      store.getState().set('dirty', true);
    }
    if (res.state === 'unavailable' || res.state === 'timeout') return { kind: 'checked' };
    const verdict = leanVerdict(res, probe.id, undefined, leanContextHash(input));
    if (verdict.step === 'ok') return { kind: 'checked', verdict };
    const latex = segmentsLatex(probe.segments);
    const evidence = [verdict.message, verdict.goals && `Still to show: ${verdict.goals}`].filter((x): x is string => !!x).map((x) => x.slice(0, 500));
    return { kind: 'rejected', feedback: { latex: latex.slice(0, 4000), reason: 'LEAN_REJECTED', evidence: evidence.slice(0, 3) } };
  }

  private recordCheckerRejection(draft: { id: string; content_hash: string }, pending: Candidate, segments: Line['segments'], proof: Proof) {
    const s = store.getState();
    const latex = segmentsLatex(segments);
    if (pending.rejectKey) s.set('rejections', addRejection(s.rejections, pending.rejectKey, draft.content_hash, latex));
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
    const recheck = inputHash(nb, payloadForCandidate(nb, ctx, first.target, c.mode === 'COMPLETE_RHS' ? 'identity' : undefined), this.cas.versionString);
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
          ...(first.extensions ? { extensions: first.extensions } : {}),
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
    if (this.syncDeclarations()) void this.recheckStale();
    // a proof step Lean could not check while it was a suggestion gets its check now
    void this.maybeCheckLean(c.targetLineId);
    this.scheduleSuggestion(500);
    return 'adopted';
  }

  /** Rejection changes no line and keeps the same candidate from reappearing in this context. */
  reject() {
    const s = store.getState();
    const c = s.candidate;
    if (!c) return;
    const latex = c.lines.map((l) => l.segments.map((seg) => (seg.type === 'math' ? seg.latex : seg.text)).join(' ')).join(' ; ');
    // a candidate that is still being generated or checked was never shown: dismissing it rejects nothing
    if (isRecordable(c.state)) s.set('rejections', addRejection(s.rejections, c.rejectKey, c.contentHash, latex));
    s.set('candidate', null);
    this.abortSlot('suggest');
    // the request is over: a check that is still running must not bring the rejected candidate back
    this.suggestSlot = null;
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
    if (!store.getState().undo()) return;
    void this.recheckStale();
    this.scheduleSuggestion();
  }

  redo() {
    this.abortAll();
    this.cancelSuggestion();
    if (!store.getState().redo()) return;
    void this.recheckStale();
    this.scheduleSuggestion();
  }

  /**
   * Marks a line as given (a premise: stated, never checked) or back to a step. Lines that are
   * only assumptions or function declarations count without the mark; the mark is for the rest,
   * such as an equation the problem states. The line and everything after it is checked again.
   */
  setGiven(lineId: string, given: boolean) {
    const s = store.getState();
    const line = findLine(this.nb, lineId);
    if (!line || line.state !== 'SETTLED' || isGiven(line) === given) return;
    if (anyPending(this.nb)) {
      s.showToast(this.deps.t('toast.waitForChecks'));
      return;
    }
    s.commit(
      'MARK_GIVEN',
      (snap) => ({ ...snap, lines: snap.lines.map((l) => (l.id === lineId ? { ...l, version: l.version + 1, role: given ? 'premise' : 'step' } : l)) }),
      lineId,
    );
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
      const res = await this.api.ocrPage(this.meta(), { image, ui_lang: this.deps.lang() });
      return res.text;
    } catch (e) {
      console.warn('[ocr]', e);
      return null;
    }
  }

  // ------------------------------------------------------------------ persistence

  /** Saves now instead of waiting for the autosave timer; true when the cloud is up to date. */
  save(): Promise<boolean> {
    return this.autosave.flush();
  }

  /** Edits the cloud does not have yet (they are kept on this device until sent). */
  get hasUnsent(): boolean {
    return this.autosave.hasUnsent;
  }

  retrySave() {
    this.autosave.retry();
  }

  /** After a conflict: drop this device's edits and open the cloud's version. */
  async reload(): Promise<boolean> {
    const id = this.nb.id;
    const res = await getRepository(this.deps.ownerId).load(id);
    if (!res) return false;
    await clearPending(this.deps.ownerId, id);
    store.getState().load(res.notebook, res.revision);
    this.autosave.reset();
    return true;
  }

  /** "Save as another notebook" after a conflict: new id, revision starts at 1. */
  async saveAsCopy(): Promise<string | null> {
    const s = store.getState();
    const original = this.nb;
    const copy: Notebook = { ...original, id: uuid(), title: this.deps.t('sync.copyTitle', { title: original.title }).slice(0, 200) };
    const res = await getRepository(this.deps.ownerId).save(copy, null);
    if (!res.ok) return null;
    await copyNotebookResources(this.deps.ownerId, original.id, copy.id).catch((e) => console.warn('[copy] resources', e));
    await clearPending(this.deps.ownerId, original.id);
    s.load(copy, res.revision);
    this.autosave.reset();
    return copy.id;
  }
}

/** A line's extensions without what belonged to its last reading: the route and Lean's verdict. */
function withoutReading(extensions: Line['extensions']): NonNullable<Line['extensions']> {
  const { route: _route, lean: _lean, ...rest } = extensions ?? {};
  return rest;
}

/** One line's Lean verdict from a check result (the target's step, or why there was none). */
function leanVerdict(res: LeanCheckResult, targetId: string, previousTactic: string | undefined, hash: string | null): LineLean {
  const at = res.steps.findIndex((st) => st.line_id === targetId);
  const step = at >= 0 ? res.steps[at]! : undefined;
  const failedBefore = at > 0 && res.steps.slice(0, at).some((st) => st.state === 'failed');
  const checked = res.state !== 'unavailable' && res.state !== 'timeout';
  return {
    tactic: step?.tactic ?? previousTactic ?? '',
    ...(step ? { step: step.state } : {}),
    proof: res.state,
    scope: res.scope,
    ...(failedBefore ? { after_failure: true } : {}),
    ...(res.statement ? { statement: res.statement } : {}),
    ...(step?.message || res.message ? { message: (step?.message ?? res.message)!.slice(0, 2000) } : {}),
    ...(res.goals ? { goals: res.goals } : {}),
    ...(res.hint && step?.state !== 'ok' ? { hint: res.hint } : {}),
    // an unreachable Lean is asked again next time; a real verdict holds until the context changes
    ...(checked && hash ? { context_hash: hash as LineLean['context_hash'] } : {}),
    ...(res.versions ? { versions: res.versions } : {}),
  };
}

/** Saves when the tab is hidden, the network returns, or the page is closed. */
function watchPage(saver: Autosaver): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onHide = () => {
    if (document.visibilityState !== 'hidden') return;
    // the page may be about to unload (reload, tab closed): device copy first, synchronously
    saver.flushLocal();
    void saver.flush();
  };
  const onOnline = () => saver.retry();
  // beforeunload comes while the page is still alive (a reload waits for the new page), so a write
  // started here has time to finish; pagehide comes just before teardown and may be cut short, but
  // is the only one iOS Safari fires reliably
  const onLeave = () => saver.flushLocal();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('beforeunload', onLeave);
    window.removeEventListener('pagehide', onLeave);
  };
}
