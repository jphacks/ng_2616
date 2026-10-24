'use client';

import { useEffect, useRef } from 'react';
import { useDevicePrefs } from '@/core/prefs/device';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { useEngine } from './engine-context';
import { useAutoConfirm, useMultiFingerTap } from './gestures';
import { LineRow } from './line-row';
import { ProblemCard } from './problem-card';

/** One ruled page: the problem card, then every line in order. */
export function NotebookPage() {
  const nb = useNotebook((s) => s.notebook);
  const activeId = useNotebook((s) => s.activeLineId);
  const ghost = useNotebook((s) => (s.candidate && ['GENERATING', 'READY'].includes(s.candidate.state) ? s.candidate.state : null));
  // a NEXT_STEP suggestion whose target line does not exist yet is shown on the last draft
  const targetMissing = useNotebook(
    (s) => !!s.candidate && s.candidate.mode === 'NEXT_STEP' && !s.notebook?.lines.some((l) => l.id === s.candidate!.targetLineId),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const t = useT();
  const engine = useEngine();

  useAutoConfirm(useDevicePrefs((s) => s.autoConfirm), watchActiveInk, (id) => void engine.confirmLine(id));

  // two fingers tap to undo, three to redo; the toast offers the opposite step
  useMultiFingerTap(scroller, {
    2: () => {
      const s = useNotebook.getState();
      if (!s.past.length) return;
      engine.undo();
      s.showToast(t('toast.undone'), 'info', { label: t('tool.redo'), run: () => engine.redo() });
    },
    3: () => {
      const s = useNotebook.getState();
      if (!s.future.length) return;
      engine.redo();
      s.showToast(t('toast.redone'), 'info', { label: t('tool.undo'), run: () => engine.undo() });
    },
  });

  // keep the active line (and any ghost suggestion on it) clear of the floating toolbar
  useEffect(() => {
    if (!activeId) return;
    const el = scroller.current?.querySelector(`[data-line-id="${activeId}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = scroller.current!.getBoundingClientRect();
    if (r.bottom > box.bottom - 120 || r.top < box.top) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeId, ghost]);

  if (!nb) return null;
  const lastDraftId = [...nb.lines].reverse().find((l) => l.state === 'DRAFT')?.id;
  const numbers = lineNumbers(nb.lines);
  const numberOf = new Map(nb.lines.map((l, i) => [l.id, numbers[i]!]));
  // rows are memoized and receive only primitives about other lines, so a stroke on one
  // line re-renders that row alone instead of the whole page
  return (
    <div ref={scroller} data-scroll-container="1" className="scrollbar-thin h-full overflow-y-auto overscroll-contain pb-40">
      <ProblemCard problem={nb.problem} />
      <div className="mx-4 mt-3 rounded-2xl bg-sheet shadow-card">
        {nb.lines.map((line, i) => {
          const ancestor = line.verified?.proof.unverified_ancestors[0];
          return (
            <LineRow
              key={line.id}
              line={line}
              number={numbers[i]!}
              isLastDraft={line.id === lastDraftId}
              revisionOf={line.revision_of ? (numberOf.get(line.revision_of) ?? null) : null}
              ancestor={ancestor ? (numberOf.get(ancestor) ?? null) : null}
              ghostWithoutTarget={targetMissing && line.id === lastDraftId}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Reports the active draft's ink each time it changes (a stroke added or erased). */
function watchActiveInk(onInk: (lineId: string, ink: readonly unknown[]) => void) {
  return useNotebook.subscribe((s, prev) => {
    const line = s.activeLineId ? s.notebook?.lines.find((l) => l.id === s.activeLineId) : undefined;
    const before = prev.activeLineId ? prev.notebook?.lines.find((l) => l.id === prev.activeLineId) : undefined;
    if (line?.state === 'DRAFT' && line.ink !== before?.ink) onInk(line.id, line.ink);
  });
}

/** Visible numbering: superseded lines keep the number of the line before them. */
function lineNumbers(lines: readonly { state: string }[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const l of lines) {
    if (l.state !== 'SUPERSEDED') n += 1;
    out.push(n);
  }
  return out;
}
