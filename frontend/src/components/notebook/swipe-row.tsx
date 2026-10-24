'use client';

import clsx from 'clsx';
import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';
import { enter } from '@/ui/motion';

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: 'neutral' | 'accent' | 'warn';
}

const ACTION_WIDTH = 88;

// at most one row is swiped open at a time
const useOpenRow = create<{ id: string | null; setOpen: (id: string | null) => void }>((set) => ({ id: null, setOpen: (id) => set({ id }) }));

const TONE: Record<NonNullable<SwipeAction['tone']>, string> = {
  neutral: 'bg-none-soft text-none',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-unknown-soft text-unknown',
};

/**
 * A row that swipes left (finger, pen or mouse) to reveal shortcuts for actions the row
 * already shows, as in Mail. The shortcuts are a gesture convenience, so they stay out of the
 * accessibility tree and tab order; the row's own buttons remain the accessible path.
 */
export function SwipeRow({ id, actions, className, children }: { id: string; actions: SwipeAction[]; className?: string; children: ReactNode }) {
  const x = useMotionValue(0);
  const openId = useOpenRow((s) => s.id);
  const setOpen = useOpenRow((s) => s.setOpen);
  const wrap = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const width = actions.length * ACTION_WIDTH;
  const open = openId === id;

  useEffect(() => {
    animate(x, open ? -width : 0, enter);
  }, [open, width, x]);

  // touching anywhere outside an open row closes it
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open, setOpen]);

  if (actions.length === 0) {
    return (
      <div data-line-id={id} className={className}>
        {children}
      </div>
    );
  }

  return (
    <div ref={wrap} data-line-id={id} className="relative overflow-hidden">
      <div aria-hidden className="absolute inset-y-0 right-0 flex" style={{ width }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={-1}
            onClick={() => {
              setOpen(null);
              a.onClick();
            }}
            className={clsx('flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium', TONE[a.tone ?? 'neutral'])}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <motion.div
        style={{ x, touchAction: 'pan-y' }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -width, right: 0 }}
        dragElastic={0.08}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          const opening = info.offset.x < -width / 2 || info.velocity.x < -400;
          const closing = info.offset.x > width / 2 || info.velocity.x > 400;
          const next = open ? !closing : opening;
          setOpen(next ? id : open ? null : openId);
          animate(x, next ? -width : 0, enter);
          // the click that ends a swipe must not also press what is under the finger
          setTimeout(() => (dragged.current = false), 0);
        }}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.stopPropagation();
            e.preventDefault();
          } else if (open) {
            e.stopPropagation();
            setOpen(null);
          }
        }}
        className={clsx('relative bg-sheet', className)}
      >
        {children}
      </motion.div>
    </div>
  );
}
