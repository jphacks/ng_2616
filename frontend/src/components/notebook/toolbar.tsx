'use client';

import clsx from 'clsx';
import { Eraser, Hand, ListPlus, PenLine, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { useNotebook, type Tool } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { IconButton } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { useEngine } from './engine-context';

const TOOLS: { tool: Tool; icon: typeof PenLine; key: string }[] = [
  { tool: 'pen', icon: PenLine, key: 'tool.pen' },
  { tool: 'eraser', icon: Eraser, key: 'tool.eraser' },
  { tool: 'view', icon: Hand, key: 'tool.view' },
];

export function Toolbar() {
  const t = useT();
  const engine = useEngine();
  const tool = useNotebook((s) => s.tool);
  const canUndo = useNotebook((s) => s.past.length > 0);
  const canRedo = useNotebook((s) => s.future.length > 0);
  const suggesting = useNotebook((s) => s.suggesting);
  const set = useNotebook((s) => s.set);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-sheet/95 p-1.5 shadow-float backdrop-blur">
        {TOOLS.map(({ tool: tl, icon: Icon, key }) => (
          <IconButton key={tl} label={t(key)} active={tool === tl} onClick={() => set('tool', tl)}>
            <Icon size={20} />
          </IconButton>
        ))}
        <Divider />
        <IconButton label={t('tool.undo')} disabled={!canUndo} onClick={() => engine.undo()}>
          <Undo2 size={20} />
        </IconButton>
        <IconButton label={t('tool.redo')} disabled={!canRedo} onClick={() => engine.redo()}>
          <Redo2 size={20} />
        </IconButton>
        <Divider />
        <IconButton label={t('tool.newLine')} onClick={() => engine.newLine()}>
          <ListPlus size={20} />
        </IconButton>
        <button
          type="button"
          onClick={() => void engine.requestSuggestion(true)}
          className={clsx('ml-1 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-medium text-white hover:bg-accent-strong')}
        >
          {suggesting ? <Spinner size={18} /> : <Sparkles size={18} />}
          <span className="hidden sm:inline">{t('tool.suggest')}</span>
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-border" aria-hidden />;
}
