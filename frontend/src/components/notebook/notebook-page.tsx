'use client';

import { useEffect, useRef } from 'react';
import { useNotebook } from '@/core/store/notebook-store';
import { LineRow } from './line-row';
import { ProblemCard } from './problem-card';

/** One ruled page: the problem card, then every line in order. */
export function NotebookPage() {
  const nb = useNotebook((s) => s.notebook);
  const activeId = useNotebook((s) => s.activeLineId);
  const ghost = useNotebook((s) => (s.candidate && ['GENERATING', 'READY'].includes(s.candidate.state) ? s.candidate.state : null));
  const scroller = useRef<HTMLDivElement>(null);

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
  return (
    <div ref={scroller} data-scroll-container="1" className="scrollbar-thin h-full overflow-y-auto overscroll-contain pb-40">
      <ProblemCard problem={nb.problem} />
      <div className="mx-4 mt-3 rounded-2xl bg-sheet shadow-card">
        {nb.lines.map((line, i) => (
          <LineRow key={line.id} line={line} nb={nb} number={numbers[i]!} isLastDraft={line.id === lastDraftId} />
        ))}
      </div>
    </div>
  );
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
