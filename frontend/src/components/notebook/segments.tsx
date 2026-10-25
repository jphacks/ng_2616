'use client';

import type { Segment } from '@mn/contracts';
import clsx from 'clsx';
import { Tex } from '@/ui/tex';

/** Prose with inline formulas, flowing like a paragraph (statements and other prose-heavy lines). */
export function InlineSegments({ segments, className }: { segments: readonly Segment[]; className?: string }) {
  return (
    <p className={clsx('leading-relaxed', className)}>
      {segments.map((s, i) => (s.type === 'math' ? <Tex key={i} latex={s.latex} className="mx-0.5 align-baseline" /> : <span key={i}>{s.text}</span>))}
    </p>
  );
}

const PROSE_WRAP = 60;

/** Recognized line in place of the ink: math via KaTeX, prose as text, in written order. */
export function Segments({ segments, className }: { segments: readonly Segment[]; className?: string }) {
  const prose = segments.reduce((n, s) => n + (s.type === 'text' ? s.text.length : 0), 0);
  // a long sentence wraps like a paragraph instead of scrolling sideways on one row
  if (prose > PROSE_WRAP) return <InlineSegments segments={segments} className={clsx('py-1 text-xl', className)} />;
  return (
    <div className={clsx('scrollbar-thin flex min-w-0 items-center gap-x-4 overflow-x-auto py-1', className)}>
      {segments.map((s, i) =>
        s.type === 'math' ? (
          <Tex key={i} latex={s.latex} className="shrink-0" />
        ) : (
          <span key={i} className="shrink-0 text-xl text-ink">
            {s.text}
          </span>
        ),
      )}
    </div>
  );
}
