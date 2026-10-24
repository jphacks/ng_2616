'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// a press that moves less than this is a click, not a drag
const DRAG_SLOP = 5;

/**
 * A horizontal row that scrolls card by card. Touch swipes natively; with a mouse or trackpad
 * it adds ‹ › buttons at the edges and click-and-drag, since browsers never scroll a row when
 * it is dragged with a mouse.
 */
export function Shelf({ children, className, prevLabel, nextLabel }: { children: ReactNode; className?: string; prevLabel: string; nextLabel: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  // the click that ends a drag must not also press the card under the pointer
  const swallowClick = useRef(false);

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure]);

  // one card (plus the gap) per press
  const step = (dir: -1 | 1) => {
    const el = row.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * (card.offsetWidth + gap), behavior: smooth ? 'smooth' : 'auto' });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      // snapping fights every manual scroll step, so it pauses until the drag ends
      setDragging(true);
    }
    e.currentTarget.scrollLeft = d.left - dx;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    setDragging(false);
  };

  return (
    <div className="group/shelf relative">
      <div
        ref={row}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragStart={(e) => e.preventDefault()}
        className={clsx('scrollbar-none flex overflow-x-auto', dragging ? 'cursor-grabbing snap-none select-none' : 'snap-x snap-mandatory', className)}
      >
        {children}
      </div>
      <EdgeButton side="start" label={prevLabel} hidden={edges.start} onClick={() => step(-1)} />
      <EdgeButton side="end" label={nextLabel} hidden={edges.end} onClick={() => step(1)} />
    </div>
  );
}

/** Only on devices with a precise pointer; touch swipes instead. */
function EdgeButton({ side, label, hidden, onClick }: { side: 'start' | 'end'; label: string; hidden: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={clsx(
        'absolute top-1/2 z-raised hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-sheet text-ink shadow-float pointer-fine:flex',
        'transition-opacity duration-fast hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none',
        side === 'start' ? 'left-2' : 'right-2',
        hidden && 'invisible opacity-0',
      )}
    >
      {side === 'start' ? <ChevronLeft size={22} aria-hidden /> : <ChevronRight size={22} aria-hidden />}
    </button>
  );
}
