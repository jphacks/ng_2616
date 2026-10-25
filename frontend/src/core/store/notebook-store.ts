'use client';

import type { Line, Notebook, Proof, Segment, SuggestMode, Target, Verified } from '@mn/contracts';
import { create } from 'zustand';
import type { RejectionHistory } from '@/core/candidates/rejection';
import type { SyncState } from '@/core/persistence/autosave';
import { HISTORY_LIMIT, interruptPending, patchPending, patchSameVersion, type Command, type CommandType, type Snapshot } from '@/core/history/history';

export type Tool = 'pen' | 'eraser' | 'view';
export type Tab = 'canvas' | 'resources';
export type CandidateState = 'GENERATING' | 'VERIFYING' | 'READY' | 'HELD' | 'NONE' | 'ADOPTED' | 'REJECTED' | 'STALE';
/** How the CAS judged a suggestion (ADR 0003): only "verified"/"assumption" adopt with one tap. */
export type CandidatePolicy = 'verified' | 'assumption' | 'unverified';

export interface CandidateLine {
  target: Target;
  segments: Segment[];
  verified?: Verified;
  /** route and Lean verdict the line keeps when adopted (ADR 0008) */
  extensions?: Line['extensions'];
}

export interface Candidate {
  id: string;
  mode: SuggestMode;
  contentHash: string;
  state: CandidateState;
  basedOnLineId: string;
  targetLineId: string;
  epoch: number;
  lines: CandidateLine[];
  policy: CandidatePolicy;
  mock: boolean;
  /** rejectionKey of the context this candidate was requested in */
  rejectKey: string;
}

export interface CheckerRejection {
  id: string;
  segments: Segment[];
  proof: Proof;
  basedOnLineId: string;
}

/** Autosave progress (core/persistence/autosave.ts); `dirty` means the cloud lacks the latest edits. */
export type SaveState = SyncState;

export interface CasStatus {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  detail?: string;
  version?: string;
}

export type Sheet = { kind: 'line'; lineId: string } | { kind: 'rejection' } | null;

/** A button on a toast, such as Undo after a destructive edit. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface NotebookState {
  notebook: Notebook | null;
  activeLineId: string | null;
  epoch: number;
  past: Command[];
  future: Command[];
  dirty: boolean;
  cloudRevision: number | null;
  saveState: SaveState;
  saveError?: string;
  tool: Tool;
  tab: Tab;
  cas: CasStatus;
  candidate: Candidate | null;
  rejection: CheckerRejection | null;
  /** hashes and LaTeX of rejected candidates, per context (core/candidates/rejection.ts) */
  rejections: RejectionHistory;
  sheet: Sheet;
  suggesting: boolean;
  /** the unverified ghost is asking for its extra confirmation */
  ghostConfirm: boolean;
  /** lines whose Lean check is still running (ADR 0008) */
  leanPending: Record<string, true>;
  toast: { id: number; text: string; tone: 'info' | 'error'; action?: ToastAction } | null;

  load(nb: Notebook, revision: number | null): void;
  unload(): void;
  /** Apply an edit as one undoable command. */
  commit(type: CommandType, mutate: (s: Snapshot) => Snapshot, lineId?: string): void;
  /** Replace a line outside history (async results), patching pending snapshots. */
  settleLine(line: Line): void;
  patchLine(id: string, fn: (l: Line) => Line): void;
  /** Same content, new verdict (Lean): replaces the line here and in history snapshots of its version. */
  annotateLine(line: Line): void;
  undo(): boolean;
  redo(): boolean;
  bumpEpoch(): number;
  setActive(id: string | null): void;
  set<K extends keyof NotebookState>(key: K, value: NotebookState[K]): void;
  showToast(text: string, tone?: 'info' | 'error', action?: ToastAction): void;
  /** The cloud holds `nb` at `revision`. */
  markSaved(nb: Notebook, revision: number): void;
}

function snapshotOf(s: NotebookState): Snapshot {
  const nb = s.notebook!;
  return { lines: nb.lines, recoveries: nb.recoveries, activeLineId: s.activeLineId };
}

function applySnapshot(nb: Notebook, snap: Snapshot): Notebook {
  return { ...nb, lines: snap.lines, recoveries: snap.recoveries };
}

let toastId = 0;

export const useNotebook = create<NotebookState>((set, get) => ({
  notebook: null,
  activeLineId: null,
  epoch: 1,
  past: [],
  future: [],
  dirty: false,
  cloudRevision: null,
  saveState: 'idle',
  tool: 'pen',
  tab: 'canvas',
  cas: { state: 'idle' },
  candidate: null,
  rejection: null,
  rejections: {},
  sheet: null,
  suggesting: false,
  ghostConfirm: false,
  leanPending: {},
  toast: null,

  load(nb, revision) {
    const draft = [...nb.lines].reverse().find((l) => l.state === 'DRAFT');
    set({
      notebook: nb,
      activeLineId: draft?.id ?? null,
      epoch: get().epoch + 1,
      past: [],
      future: [],
      dirty: false,
      cloudRevision: revision,
      saveState: 'idle',
      candidate: null,
      rejection: null,
      rejections: {},
      sheet: null,
      leanPending: {},
    });
  },

  unload() {
    set({ notebook: null, activeLineId: null, past: [], future: [], candidate: null, rejection: null, sheet: null, epoch: get().epoch + 1 });
  },

  commit(type, mutate, lineId) {
    const s = get();
    if (!s.notebook) return;
    const before = snapshotOf(s);
    const after = mutate(before);
    if (after === before) return;
    const past = [...s.past, { type, lineId, before, after }].slice(-HISTORY_LIMIT);
    set({ notebook: applySnapshot(s.notebook, after), activeLineId: after.activeLineId, past, future: [], dirty: true });
  },

  settleLine(line) {
    const s = get();
    if (!s.notebook) return;
    const lines = s.notebook.lines.map((l) => (l.id === line.id ? line : l));
    set({ notebook: { ...s.notebook, lines }, past: patchPending(s.past, line), future: patchPending(s.future, line), dirty: true });
  },

  annotateLine(line) {
    const s = get();
    if (!s.notebook) return;
    const lines = s.notebook.lines.map((l) => (l.id === line.id ? line : l));
    set({ notebook: { ...s.notebook, lines }, past: patchSameVersion(s.past, line), future: patchSameVersion(s.future, line), dirty: true });
  },

  patchLine(id, fn) {
    const s = get();
    if (!s.notebook) return;
    set({ notebook: { ...s.notebook, lines: s.notebook.lines.map((l) => (l.id === id ? fn(l) : l)) }, dirty: true });
  },

  undo() {
    const s = get();
    const cmd = s.past[s.past.length - 1];
    if (!cmd || !s.notebook) return false;
    set({
      notebook: applySnapshot(s.notebook, cmd.before),
      activeLineId: cmd.before.activeLineId,
      past: s.past.slice(0, -1),
      future: [...s.future, cmd],
      epoch: s.epoch + 1,
      dirty: true,
      candidate: null,
      rejection: null,
    });
    return true;
  },

  redo() {
    const s = get();
    const cmd = s.future[s.future.length - 1];
    if (!cmd || !s.notebook) return false;
    const after = interruptPending(cmd.after);
    set({
      notebook: applySnapshot(s.notebook, after),
      activeLineId: after.activeLineId,
      past: [...s.past, { ...cmd, after }],
      future: s.future.slice(0, -1),
      epoch: s.epoch + 1,
      dirty: true,
      candidate: null,
      rejection: null,
    });
    return true;
  },

  bumpEpoch() {
    const epoch = get().epoch + 1;
    set({ epoch });
    return epoch;
  },

  setActive(id) {
    set({ activeLineId: id });
  },

  set(key, value) {
    set({ [key]: value } as Partial<NotebookState>);
  },

  showToast(text, tone = 'info', action) {
    toastId += 1;
    const id = toastId;
    set({ toast: { id, text, tone, action } });
    // a toast that can be acted on stays a little longer
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, action ? 5000 : 4000);
  },

  markSaved(nb, revision) {
    if (get().notebook?.id !== nb.id) return;
    // edits made during the save stay dirty
    set({ cloudRevision: revision, dirty: get().notebook !== nb });
  },
}));

export const notebookStore = useNotebook;
