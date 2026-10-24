'use client';

import { Popover } from '@base-ui/react/popover';
import clsx from 'clsx';
import { Eraser, GripVertical, Hand, ListPlus, PenLine, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { animate, motion, useDragControls, useMotionValue } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { INK_WEIGHTS, useDevicePrefs, type InkWeight, type ToolbarSide } from '@/core/prefs/device';
import { useNotebook, type Tool } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { IconButton } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { useEngine } from './engine-context';
import { useHoldRepeat } from './gestures';

const TOOLS: { tool: Tool; icon: typeof PenLine; key: string }[] = [
  { tool: 'pen', icon: PenLine, key: 'tool.pen' },
  { tool: 'eraser', icon: Eraser, key: 'tool.eraser' },
  { tool: 'view', icon: Hand, key: 'tool.view' },
];

const WEIGHTS: InkWeight[] = ['thin', 'medium', 'thick'];

const SIDE_CLASS: Record<ToolbarSide, string> = { left: 'justify-start', center: 'justify-center', right: 'justify-end' };

export function Toolbar() {
  const t = useT();
  const engine = useEngine();
  const tool = useNotebook((s) => s.tool);
  const canUndo = useNotebook((s) => s.past.length > 0);
  const canRedo = useNotebook((s) => s.future.length > 0);
  const suggesting = useNotebook((s) => s.suggesting);
  const set = useNotebook((s) => s.set);
  const side = useDevicePrefs((s) => s.toolbarSide);
  const inkWeight = useDevicePrefs((s) => s.inkWeight);
  const setPref = useDevicePrefs((s) => s.setPref);
  const drag = useDragControls();
  const lane = useRef<HTMLDivElement>(null);
  const penButton = useRef<HTMLButtonElement>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  // where the bar was when it was dropped, to glide from there to its new side (FLIP)
  const dropped = useRef<number | null>(null);

  useLayoutEffect(() => {
    const from = dropped.current;
    dropped.current = null;
    const el = bar.current;
    if (from === null || !el) return;
    x.set(0);
    x.set(from - el.getBoundingClientRect().left);
    animate(x, 0, { duration: 0.2, ease: 'easeOut' });
  }, [side, x]);
  // holding Undo or Redo keeps stepping through history
  const undoPress = useHoldRepeat(() => engine.undo(), canUndo);
  const redoPress = useHoldRepeat(() => engine.redo(), canRedo);

  return (
    <div ref={lane} className={clsx('pointer-events-none absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 flex px-4', SIDE_CLASS[side])}>
      <motion.div
        ref={bar}
        style={{ x }}
        drag="x"
        dragControls={drag}
        dragListener={false}
        dragMomentum={false}
        // dropped in the left, middle or right third of the screen, the toolbar settles there
        onDragEnd={(_, info) => {
          const box = lane.current?.getBoundingClientRect();
          if (!box || !bar.current) return;
          const at = (info.point.x - window.scrollX - box.left) / box.width;
          const next = at < 1 / 3 ? 'left' : at > 2 / 3 ? 'right' : 'center';
          dropped.current = bar.current.getBoundingClientRect().left;
          if (next === side) {
            animate(x, 0, { duration: 0.2, ease: 'easeOut' });
            dropped.current = null;
          } else setPref('toolbarSide', next);
        }}
        className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-sheet/95 p-1.5 shadow-float backdrop-blur"
      >
        <button
          type="button"
          aria-label={t('tool.move')}
          title={t('tool.move')}
          onPointerDown={(e) => drag.start(e)}
          className="-mr-0.5 inline-flex h-11 w-6 cursor-grab touch-none items-center justify-center rounded-lg text-faint hover:text-ink-soft active:cursor-grabbing"
        >
          <GripVertical size={16} aria-hidden />
        </button>
        {TOOLS.map(({ tool: tl, icon: Icon, key }) => (
          <IconButton
            key={tl}
            ref={tl === 'pen' ? penButton : undefined}
            label={t(key)}
            active={tool === tl}
            aria-haspopup={tl === 'pen' && tool === 'pen' ? 'dialog' : undefined}
            aria-expanded={tl === 'pen' && tool === 'pen' ? weightsOpen : undefined}
            // tapping the pen again opens its thickness
            onClick={() => (tl === 'pen' && tool === 'pen' ? setWeightsOpen((o) => !o) : set('tool', tl))}
          >
            <Icon size={20} />
          </IconButton>
        ))}
        <Divider />
        <IconButton label={t('tool.undo')} disabled={!canUndo} {...undoPress}>
          <Undo2 size={20} />
        </IconButton>
        <IconButton label={t('tool.redo')} disabled={!canRedo} {...redoPress}>
          <Redo2 size={20} />
        </IconButton>
        <Divider />
        <IconButton label={t('tool.newLine')} onClick={() => engine.newLine()}>
          <ListPlus size={20} />
        </IconButton>
        <button
          type="button"
          onClick={() => void engine.requestSuggestion(true)}
          className="ml-1 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-medium text-white hover:bg-accent-strong"
        >
          {suggesting ? <Spinner size={18} /> : <Sparkles size={18} />}
          <span className="hidden sm:inline">{t('tool.suggest')}</span>
        </button>
      </motion.div>

      <Popover.Root open={weightsOpen} onOpenChange={setWeightsOpen}>
        <Popover.Portal>
          <Popover.Positioner anchor={penButton} side="top" sideOffset={10} className="z-50">
            <Popover.Popup className="origin-[var(--transform-origin)] rounded-2xl bg-sheet p-1.5 shadow-float outline-none transition-[scale,opacity] duration-150 ease-out motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <Popover.Title className="sr-only">{t('tool.inkWeight')}</Popover.Title>
              <div className="flex gap-1">
                {WEIGHTS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={inkWeight === w}
                    aria-label={t(`ink.${w}`)}
                    title={t(`ink.${w}`)}
                    onClick={() => {
                      setPref('inkWeight', w);
                      setWeightsOpen(false);
                    }}
                    className={clsx('flex size-11 items-center justify-center rounded-xl', inkWeight === w ? 'bg-accent-soft' : 'hover:bg-black/5')}
                  >
                    <span className="rounded-full bg-ink" style={{ width: INK_WEIGHTS[w] * 2.4, height: INK_WEIGHTS[w] * 2.4 }} />
                  </button>
                ))}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-border" aria-hidden />;
}
