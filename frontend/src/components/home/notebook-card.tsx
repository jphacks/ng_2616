'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, useSyncExternalStore, type MouseEvent } from 'react';
import type { NotebookSummary } from '@/core/persistence/repo';
import { useLocale, useT } from '@/i18n';
import { NotebookPreview } from './notebook-preview';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

// one shared clock for every card's relative time, ticking once a minute
let minute = Date.now();
const subscribeMinute = (onTick: () => void) => {
  // the clock stops while no card is shown, so catch up when one appears
  if (Date.now() - minute >= 60_000) {
    minute = Date.now();
    queueMicrotask(onTick);
  }
  const id = setInterval(() => {
    minute = Date.now();
    onTick();
  }, 60_000);
  return () => clearInterval(id);
};

function useEdited(iso: string): string {
  const t = useT();
  const { locale } = useLocale();
  const now = useSyncExternalStore(subscribeMinute, () => minute, () => minute);
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const unit = UNITS.find(([, s]) => Math.abs(seconds) >= s);
  if (!unit) return t('home.justNow');
  const when = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / unit[1]), unit[0]);
  return t('home.updated', { when });
}

export interface CardHandlers {
  onOpen: (id: string) => void;
  /** Opens the card menu against an element, or at the pointer for a right-click. */
  onMenu: (id: string, anchor: Element | { x: number; y: number }) => void;
}

/**
 * A notebook in the grid. Tap or click opens it; holding (finger, pen or mouse) lifts it and
 * opens its menu, and moving after the lift drags it. Right-click also opens the menu.
 */
export function NotebookCard({
  nb,
  index,
  lifted,
  stagger,
  reorderable,
  handlers,
}: {
  nb: NotebookSummary;
  index: number;
  lifted: boolean;
  stagger: boolean;
  reorderable: boolean;
  handlers: CardHandlers;
}) {
  const t = useT();
  const edited = useEdited(nb.updated_at);
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: nb.id });
  // the card answers a press at once, so a hold visibly builds up before it lifts
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // a touch hold is handled by the drag sensor, which also opens the menu
    const type = (e.nativeEvent as PointerEvent).pointerType;
    if (type === 'touch' || type === 'pen') return;
    handlers.onMenu(nb.id, { x: e.clientX, y: e.clientY });
  };

  return (
    <li
      ref={setNodeRef}
      data-card-id={nb.id}
      style={{ transform: reorderable ? CSS.Translate.toString(transform) : undefined, transition }}
      className={clsx('relative select-none [-webkit-touch-callout:none]', isDragging ? 'z-20' : 'z-0')}
      onContextMenu={onContextMenu}
      {...listeners}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, scale: lifted ? 1.03 : pressed ? 0.97 : 1 }}
        onPointerDown={(e) => e.button === 0 && setPressed(true)}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: 'easeOut' } }}
        transition={{ duration: 0.2, ease: 'easeOut', delay: stagger ? Math.min(index, 8) * 0.03 : 0, scale: { duration: 0.15 } }}
        className={clsx(
          'group relative overflow-hidden rounded-3xl bg-sheet',
          lifted ? 'shadow-float' : 'shadow-card',
        )}
      >
        <button
          type="button"
          onClick={() => handlers.onOpen(nb.id)}
          className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
        >
          <NotebookPreview preview={nb.preview} />
          <span className="block space-y-1 border-t border-border px-4 pt-3 pb-4">
            <span className="line-clamp-2 text-[15px] leading-snug font-medium text-balance">{nb.title}</span>
            <span className="flex items-center gap-2 text-[12px] text-muted tabular-nums">
              <span className="truncate">{edited}</span>
              {nb.demo && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">{t('home.demo')}</span>}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={t('home.more')}
          onClick={(e) => handlers.onMenu(nb.id, e.currentTarget)}
          // a press on this button must not start a drag of the card
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-sheet/90 text-ink-soft shadow-card transition-transform duration-150 active:scale-90">
            <MoreHorizontal size={18} aria-hidden />
          </span>
        </button>
      </motion.div>
    </li>
  );
}

/** Same shape as a card, shown while the list loads. */
export function NotebookCardSkeleton() {
  return (
    <li aria-hidden className="overflow-hidden rounded-3xl bg-sheet shadow-card">
      <Bone className="aspect-[4/3]" />
      <div className="space-y-2.5 border-t border-border px-4 pt-3.5 pb-4">
        <Bone className="h-3.5 w-3/4 rounded-full" />
        <Bone className="h-3 w-1/3 rounded-full" />
      </div>
    </li>
  );
}

function Bone({ className }: { className: string }) {
  return (
    <div className={clsx('relative overflow-hidden bg-black/[0.05]', className)}>
      <div className="shimmer absolute inset-0" />
    </div>
  );
}
