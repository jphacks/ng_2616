'use client';

import type { Status, Stroke } from '@mn/contracts';
import clsx from 'clsx';
import { Check, CircleHelp, X } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { outlineToPath, strokeOutline, strokesBounds } from '@/core/ink/stroke';
import type { NotebookPreview as Preview, PreviewLine } from '@/core/notebook/preview';
import { Tex } from '@/ui/tex';

// the miniature is laid out at this width, then scaled to the card; the height follows the
// landscape page ratio of the card (--aspect-page)
const PAGE_WIDTH = 560;
const PAGE_HEIGHT = (PAGE_WIDTH * 820) / 1180;

/** The top of the notebook's first page, drawn from its data and scaled to fill its card. */
export const NotebookPreview = memo(function NotebookPreview({ preview }: { preview: Preview | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry!.contentRect.width / PAGE_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = preview?.lines.length ? preview.lines : [null];
  return (
    <div ref={box} aria-hidden className="graph-paper absolute inset-0 overflow-hidden">
      {scale !== null && (
        <div className="absolute top-0 left-0 origin-top-left p-4" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}>
          {lines.map((line, i) => (
            <PreviewRow key={i} number={i + 1} line={line} />
          ))}
        </div>
      )}
    </div>
  );
});

function PreviewRow({ number, line }: { number: number; line: PreviewLine | null }) {
  return (
    <div className="flex h-[84px] items-center gap-3 overflow-hidden pr-5">
      <span className="w-10 shrink-0 text-right text-2xs font-medium text-faint tabular-nums">{number}</span>
      <div className="min-w-0 flex-1 overflow-hidden">
        {line?.segments.length ? (
          <div className="flex items-center gap-x-4 whitespace-nowrap">
            {line.segments.map((s, i) =>
              s.type === 'math' ? (
                <Tex key={i} latex={s.latex} className="shrink-0" />
              ) : (
                <span key={i} className="shrink-0 text-xl text-ink-soft">
                  {s.text}
                </span>
              ),
            )}
          </div>
        ) : line?.ink.length ? (
          <InkThumb strokes={line.ink} />
        ) : null}
      </div>
      {line?.status && <StatusMark status={line.status} />}
    </div>
  );
}

const InkThumb = memo(function InkThumb({ strokes }: { strokes: Stroke[] }) {
  const paths = useMemo(() => strokes.map((s) => (s.points.length > 1 ? outlineToPath(strokeOutline(s.points)) : '')), [strokes]);
  const b = strokesBounds(strokes);
  if (!b) return null;
  const pad = 6;
  return (
    <svg
      viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`}
      preserveAspectRatio="xMinYMid meet"
      className="h-16 w-full fill-ink"
    >
      {strokes.map((s, i) =>
        s.points.length > 1 ? <path key={s.id} d={paths[i]} /> : <circle key={s.id} cx={s.points[0]!.x} cy={s.points[0]!.y} r={1.7} />,
      )}
    </svg>
  );
});

function StatusMark({ status }: { status: Status }) {
  if (status === 'none') return null;
  const Icon = status === 'ok' ? Check : status === 'wrong' ? X : CircleHelp;
  return (
    <span
      className={clsx(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        status === 'ok' ? 'bg-ok-soft text-ok' : status === 'wrong' ? 'bg-wrong-soft text-wrong-strong' : 'bg-unknown-soft text-unknown',
      )}
    >
      <Icon size={18} />
    </span>
  );
}
