import type { Line, Problem, Recovery } from '@mn/contracts';
import { PENDING_STATES } from '@/core/notebook/model';

export type CommandType =
  | 'ADD_STROKE'
  | 'ERASE_STROKES'
  | 'CLEAR_DRAFT'
  | 'ADD_DRAFT'
  | 'CONFIRM_LINE'
  | 'START_REVISION'
  | 'ADOPT_CANDIDATE'
  | 'REJECT_CANDIDATE'
  | 'IMPORT_PDF'
  | 'EDIT_PROBLEM';

/** Serializable before/after state of everything an edit can touch (spec §12.2). */
export interface Snapshot {
  lines: Line[];
  recoveries: Recovery[];
  problem: Problem;
  activeLineId: string | null;
}

export interface Command {
  type: CommandType;
  lineId?: string;
  before: Snapshot;
  after: Snapshot;
}

export const HISTORY_LIMIT = 200;

/**
 * When an asynchronous result settles a line, every history snapshot that still holds that
 * line in its pending state receives the settled version, so Undo/Redo never re-submits
 * completed work and never resurrects a stale "recognizing" line.
 */
export function patchPending(commands: Command[], settled: Line): Command[] {
  const patch = (s: Snapshot): Snapshot => {
    let changed = false;
    const lines = s.lines.map((l) => {
      if (l.id === settled.id && PENDING_STATES.has(l.state)) {
        changed = true;
        return settled;
      }
      return l;
    });
    return changed ? { ...s, lines } : s;
  };
  return commands.map((c) => ({ ...c, before: patch(c.before), after: patch(c.after) }));
}

/** Redo of an unfinished command restores an explicit retry state, never automatic paid work. */
export function interruptPending(s: Snapshot): Snapshot {
  if (!s.lines.some((l) => PENDING_STATES.has(l.state))) return s;
  return {
    ...s,
    lines: s.lines.map((l) =>
      PENDING_STATES.has(l.state)
        ? { ...l, version: l.version + 1, state: 'RECOGNIZE_FAILED', failure: { stage: l.state === 'VERIFYING' ? 'verify' : 'recognize', code: 'INTERRUPTED' } }
        : l,
    ),
  };
}
