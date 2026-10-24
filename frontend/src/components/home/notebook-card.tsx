'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { Check, MoreVertical } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useState, useSyncExternalStore, type MouseEvent } from 'react';
import type { NotebookSummary } from '@/core/persistence/repo';
import { useLocale, useT } from '@/i18n';
import { NotebookPreview } from './notebook-preview';
import { enter, exit } from '@/ui/motion';

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
  /** In selection mode, a tap selects or deselects instead of opening. */
  onToggle: (id: string) => void;
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
  selection,
  handlers,
}: {
  nb: NotebookSummary;
  index: number;
  lifted: boolean;
  stagger: boolean;
  reorderable: boolean;
  /** null outside selection mode; otherwise whether this card is selected */
  selection: boolean | null;
  handlers: CardHandlers;
}) {
  const t = useT();
  const edited = useEdited(nb.updated_at);
  const labelId = useId();
  const selecting = selection !== null;
  // while selecting, a hold or drag does nothing, so taps only select
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: nb.id, disabled: selecting });
  // the card answers a press at once, so a hold visibly builds up before it lifts
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // a touch hold is handled by the drag sensor, which also opens the menu
    const type = (e.nativeEvent as PointerEvent).pointerType;
    if (type === 'touch' || type === 'pen' || selecting) return;
    handlers.onMenu(nb.id, { x: e.clientX, y: e.clientY });
  };

  return (
    <li
      ref={setNodeRef}
      data-card-id={nb.id}
      style={{ transform: reorderable ? CSS.Translate.toString(transform) : undefined, transition }}
      className={clsx('relative select-none [-webkit-touch-callout:none]', isDragging ? 'z-lifted' : 'z-base')}
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
        exit={{ opacity: 0, scale: 0.96, transition: exit }}
        transition={{ ...enter, delay: stagger ? Math.min(index, 8) * 0.03 : 0, scale: exit }}
        className={clsx(
          'group relative aspect-page overflow-hidden rounded-3xl bg-sheet',
          lifted ? 'shadow-float' : 'shadow-card',
          selection && 'ring-2 ring-accent',
        )}
      >
        {/* the page fills the card and opens it; the band along the bottom only labels it,
            so clicks on the title fall through to the card, except on the menu button */}
        <button
          type="button"
          aria-labelledby={`${labelId}-title ${labelId}-edited`}
          aria-pressed={selecting ? selection : undefined}
          onClick={() => (selecting ? handlers.onToggle(nb.id) : handlers.onOpen(nb.id))}
          className="absolute inset-0 block text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
        >
          <NotebookPreview preview={nb.preview} />
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-ink/90 py-2 pr-1.5 pl-4">
          <div className="min-w-0 flex-1">
            <span id={`${labelId}-title`} data-card-title className="block truncate text-base font-semibold text-on-solid">
              {nb.title}
            </span>
            <span id={`${labelId}-edited`} className="block truncate text-xs text-on-solid/70 tabular-nums">
              {edited}
            </span>
          </div>
          {!selecting && (
            <button
              type="button"
              aria-label={t('home.more')}
              onClick={(e) => handlers.onMenu(nb.id, e.currentTarget)}
              // a press on this button must not start a drag of the card
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full text-on-solid/80 outline-none transition-transform duration-fast hover:bg-on-solid/10 hover:text-on-solid focus-visible:ring-2 focus-visible:ring-on-solid/60 active:scale-90"
            >
              <MoreVertical size={20} aria-hidden />
            </button>
          )}
        </div>
        {selecting && (
          <span
            aria-hidden
            className={clsx(
              'pointer-events-none absolute top-3 left-3 flex size-7 items-center justify-center rounded-full ring-2',
              selection ? 'bg-accent text-on-solid ring-accent' : 'bg-sheet/90 ring-border',
            )}
          >
            {selection && <Check size={16} />}
          </span>
        )}
      </motion.div>
    </li>
  );
}

/** Same shape as a card, shown while the list loads. */
export function NotebookCardSkeleton() {
  return (
    <li aria-hidden className="relative aspect-page overflow-hidden rounded-3xl bg-sheet shadow-card">
      <Bone className="absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-fill px-4 pt-3 pb-3.5">
        <Bone className="h-3.5 w-3/4 rounded-full" />
        <Bone className="h-3 w-1/3 rounded-full" />
      </div>
    </li>
  );
}

function Bone({ className }: { className: string }) {
  return (
    <div className={clsx('relative overflow-hidden bg-fill', className)}>
      <div className="shimmer absolute inset-0" />
    </div>
  );
}
