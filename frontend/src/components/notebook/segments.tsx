'use client';

import type { Segment } from '@mn/contracts';
import clsx from 'clsx';
import { Tex } from '@/ui/tex';

/** Prose with inline formulas, flowing like a paragraph (problem statements). */
export function InlineSegments({ segments, className }: { segments: readonly Segment[]; className?: string }) {
  return (
    <p className={clsx('leading-relaxed', className)}>
      {segments.map((s, i) => (s.type === 'math' ? <Tex key={i} latex={s.latex} className="mx-0.5 align-baseline" /> : <span key={i}>{s.text}</span>))}
    </p>
  );
}

/** Recognized line in place of the ink: math via KaTeX, prose as text, in written order. */
export function Segments({ segments, className }: { segments: readonly Segment[]; className?: string }) {
  return (
    <div className={clsx('scrollbar-thin flex min-w-0 items-center gap-x-4 overflow-x-auto py-1', className)}>
      {segments.map((s, i) =>
        s.type === 'math' ? (
          <Tex key={i} latex={s.latex} className="shrink-0" />
        ) : (
          <span key={i} className="shrink-0 text-[17px] text-ink-soft">
            {s.text}
          </span>
        ),
      )}
    </div>
  );
}
