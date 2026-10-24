'use client';

import {
  closestCenter,
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { ArrowLeft, ArrowRight, Copy, FolderOpen, PenLine, Trash2 } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import type { NotebookSummary } from '@/core/persistence/repo';
import { useT } from '@/i18n';
import { TextFieldDialog } from '@/ui/dialog';
import { Menu, MenuItem, MenuPopup, MenuSeparator } from '@/ui/menu';
import { NotebookCard, type CardHandlers } from './notebook-card';

// how long a touch must rest on a card before it lifts (menu), and how far it may drift meanwhile
const HOLD_MS = 400;
const HOLD_TOLERANCE = 8;
// once lifted, moving this far turns the hold into a drag and closes the menu
const DRAG_THRESHOLD = 10;

type Anchor = Element | { x: number; y: number };

const toAnchor = (a: Anchor) =>
  a instanceof Element ? a : { getBoundingClientRect: () => DOMRect.fromRect({ x: a.x, y: a.y, width: 0, height: 0 }) };

export interface GridActions {
  open: (id: string) => void;
  rename: (id: string, title: string) => Promise<string | void>;
  duplicate: (id: string) => void;
  remove: (nb: NotebookSummary) => void;
  /** New full order of the visible notebooks. */
  reorder: (ids: string[]) => void;
}

export function NotebookGrid({ items, reorderable, stagger, actions }: { items: NotebookSummary[]; reorderable: boolean; stagger: boolean; actions: GridActions }) {
  const t = useT();
  const [menu, setMenu] = useState<{ id: string; anchor: Anchor; touch: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<NotebookSummary | null>(null);
  const hold = useRef<{ id: string; moved: boolean } | null>(null);
  // the click a browser synthesizes after a hold is released must not dismiss the menu it opened
  const holdReleasedAt = useRef(0);
  const ids = useMemo(() => items.map((n) => n.id), [items]);
  const target = menu ? items.find((n) => n.id === menu.id) : undefined;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: HOLD_MS, tolerance: HOLD_TOLERANCE } }),
  );

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const id = String(active.id);
    setDragging(id);
    if (typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent) {
      // like a long-press on a home screen: lift and show the menu; moving on turns it into a drag
      hold.current = { id, moved: false };
      const el = document.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
      if (el) setMenu({ id, anchor: el, touch: true });
      navigator.vibrate?.(8);
    }
  };

  const onDragMove = ({ delta }: DragMoveEvent) => {
    if (hold.current && !hold.current.moved && Math.hypot(delta.x, delta.y) > DRAG_THRESHOLD) {
      hold.current.moved = true;
      setMenu(null);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const wasHold = hold.current && !hold.current.moved;
    if (wasHold) holdReleasedAt.current = performance.now();
    hold.current = null;
    setDragging(null);
    if (wasHold || !reorderable || !over || active.id === over.id) return;
    actions.reorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  const handlers: CardHandlers = {
    onOpen: actions.open,
    onMenu: (id, anchor) => setMenu({ id, anchor, touch: false }),
  };

  // the keyboard and switch-access way to reorder, alongside dragging
  const move = (id: string, by: -1 | 1) => {
    const from = ids.indexOf(id);
    actions.reorder(arrayMove(ids, from, from + by));
  };
  const at = target ? ids.indexOf(target.id) : -1;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          hold.current = null;
          setDragging(null);
        }}
      >
        <SortableContext items={ids} strategy={reorderable ? rectSortingStrategy : () => null}>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence initial={false}>
              {items.map((nb, i) => (
                <NotebookCard
                  key={nb.id}
                  nb={nb}
                  index={i}
                  stagger={stagger}
                  reorderable={reorderable}
                  lifted={dragging === nb.id || (menu?.touch === true && menu.id === nb.id)}
                  handlers={handlers}
                />
              ))}
            </AnimatePresence>
          </ul>
        </SortableContext>
      </DndContext>

      <Menu.Root
        open={!!target}
        onOpenChange={(open, details) => {
          if (open) return;
          if (details.reason === 'outside-press' && performance.now() - holdReleasedAt.current < 500) return;
          setMenu(null);
        }}
        modal={false}
      >
        {target && (
          <MenuPopup anchor={toAnchor(menu!.anchor)} side="bottom" align={menu!.anchor instanceof Element && !menu!.touch ? 'end' : 'center'}>
            <MenuItem icon={<FolderOpen size={18} />} onClick={() => actions.open(target.id)}>
              {t('home.open')}
            </MenuItem>
            <MenuItem icon={<PenLine size={18} />} onClick={() => setRenaming(target)}>
              {t('home.rename')}
            </MenuItem>
            <MenuItem icon={<Copy size={18} />} onClick={() => actions.duplicate(target.id)}>
              {t('home.duplicate')}
            </MenuItem>
            {reorderable && items.length > 1 && (
              <>
                <MenuSeparator />
                <MenuItem icon={<ArrowLeft size={18} />} disabled={at === 0} onClick={() => move(target.id, -1)}>
                  {t('home.moveEarlier')}
                </MenuItem>
                <MenuItem icon={<ArrowRight size={18} />} disabled={at === ids.length - 1} onClick={() => move(target.id, 1)}>
                  {t('home.moveLater')}
                </MenuItem>
              </>
            )}
            <MenuSeparator />
            <MenuItem danger icon={<Trash2 size={18} />} onClick={() => actions.remove(target)}>
              {t('common.delete')}
            </MenuItem>
          </MenuPopup>
        )}
      </Menu.Root>

      <TextFieldDialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={t('home.renameTitle')}
        label={t('home.nameLabel')}
        initialValue={renaming?.title ?? ''}
        maxLength={200}
        submitLabel={t('home.rename')}
        cancelLabel={t('common.cancel')}
        onSubmit={(title) => actions.rename(renaming!.id, title)}
      />
    </>
  );
}
