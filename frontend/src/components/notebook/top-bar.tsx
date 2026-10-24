'use client';

import clsx from 'clsx';
import { ChevronLeft, CircleAlert, Cpu, Languages, Save } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { demoBinding } from '@/core/presets';
import { useNotebook } from '@/core/store/notebook-store';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { SegmentedTabs } from '@/ui/tabs';
import { useEngine } from './engine-context';
import { PdfExport } from './pdf-export';

export function TopBar({ mockAi }: { mockAi: boolean }) {
  const t = useT();
  const engine = useEngine();
  // select only what the bar shows, so ink edits do not re-render it
  const nb = useNotebook(useShallow((s) => (s.notebook ? { title: s.notebook.title, demo: !!demoBinding(s.notebook) } : null)));
  const tab = useNotebook((s) => s.tab);
  const cas = useNotebook((s) => s.cas);
  const dirty = useNotebook((s) => s.dirty);
  const saveState = useNotebook((s) => s.saveState);
  const set = useNotebook((s) => s.set);
  const { locale, setLocale } = useLocale();
  const [editing, setEditing] = useState(false);
  if (!nb) return null;
  const demo = nb.demo;

  return (
    <header className="relative z-20 flex min-h-16 items-center gap-3 border-b border-border bg-paper/95 px-3 backdrop-blur">
      <Link
        href="/notebooks"
        onClick={(e) => {
          if (dirty && !window.confirm(t('top.unsavedLeave'))) e.preventDefault();
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-[15px] text-ink-soft hover:bg-black/5"
      >
        <ChevronLeft size={20} />
        <span className="hidden lg:inline">{t('top.notebooks')}</span>
      </Link>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            defaultValue={nb.title}
            maxLength={200}
            onBlur={(e) => {
              engine.rename(e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-lg bg-sheet px-2 py-1 text-[16px] font-semibold outline-none ring-2 ring-accent/40"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="max-w-full truncate rounded-lg px-2 py-1 text-left text-[16px] font-semibold hover:bg-black/5">
            {nb.title}
          </button>
        )}
        <div className="flex items-center gap-2 px-2 text-[12px] text-muted">
          <CasPill state={cas.state} />
          {demo && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-strong">{t('top.demo')}</span>}
          {mockAi && <span className="rounded-full bg-unknown-soft px-2 py-0.5 font-medium text-unknown">{t('top.mock')}</span>}
        </div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 max-md:static max-md:translate-x-0">
        <SegmentedTabs
          value={tab}
          onChange={(v) => set('tab', v)}
          items={[
            { value: 'canvas', label: t('tab.canvas') },
            { value: 'resources', label: t('tab.resources') },
          ]}
        />
      </div>
      <div className="flex flex-1 items-center justify-end gap-2">
        <PdfExport />
        <SaveButton dirty={dirty} state={saveState} onSave={() => void engine.save()} />
        <Button variant="ghost" size="md" icon={<Languages size={18} />} onClick={() => setLocale(locale === 'en' ? 'ja' : 'en')}>
          <span className="hidden lg:inline">{t('top.language')}</span>
        </Button>
      </div>
    </header>
  );
}

function CasPill({ state }: { state: string }) {
  const t = useT();
  return (
    <span className={clsx('inline-flex items-center gap-1', state === 'failed' ? 'text-wrong-strong' : state === 'ready' ? 'text-ok' : 'text-muted')}>
      {state === 'ready' ? <Cpu size={13} /> : state === 'failed' ? <CircleAlert size={13} /> : <Spinner size={12} />}
      {t(state === 'ready' ? 'top.checkerReady' : state === 'failed' ? 'top.checkerFailed' : 'top.checkerLoading')}
    </span>
  );
}

function SaveButton({ dirty, state, onSave }: { dirty: boolean; state: string; onSave: () => void }) {
  const t = useT();
  const engine = useEngine();
  if (state === 'conflict') {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[13px] text-wrong-strong">{t('top.conflict')}</span>
        <Button size="sm" onClick={() => window.location.reload()}>
          {t('top.reload')}
        </Button>
        <Button size="sm" onClick={() => void engine.saveAsCopy()}>
          {t('top.saveCopy')}
        </Button>
      </div>
    );
  }
  const label = state === 'saving' ? t('top.saving') : state === 'error' ? t('top.saveFailed') : dirty ? t('top.save') : t('top.saved');
  return (
    <Button
      variant={dirty ? 'primary' : 'secondary'}
      icon={state === 'saving' ? <Spinner /> : state === 'error' ? <CircleAlert size={18} /> : <Save size={18} />}
      disabled={state === 'saving' || (!dirty && state !== 'error')}
      onClick={onSave}
      title={dirty ? t('top.unsaved') : undefined}
    >
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
