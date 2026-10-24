'use client';

import clsx from 'clsx';
import { ChevronLeft, CircleAlert, Cpu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SessionUser } from '@/core/auth/browser';
import { demoBinding } from '@/core/presets';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { AccountMenu } from '@/components/account/account-menu';
import { APP_BUILD_VERSION } from '@/core/version';
import { Spinner } from '@/ui/spinner';
import { SegmentedTabs } from '@/ui/tabs';
import { useEngine } from './engine-context';
import { QuestionImportButton } from '@/components/resources/question-import';
import { SaveStatus } from './save-status';

export function TopBar({ mockAi, user }: { mockAi: boolean; user: SessionUser }) {
  const t = useT();
  const engine = useEngine();
  // select only what the bar shows, so ink edits do not re-render it
  const nb = useNotebook(useShallow((s) => (s.notebook ? { title: s.notebook.title, demo: !!demoBinding(s.notebook) } : null)));
  const tab = useNotebook((s) => s.tab);
  const cas = useNotebook((s) => s.cas);
  const dirty = useNotebook((s) => s.dirty);
  const set = useNotebook((s) => s.set);
  const [editing, setEditing] = useState(false);
  if (!nb) return null;
  const demo = nb.demo;

  return (
    <header className="relative z-lifted flex min-h-16 items-center gap-3 border-b border-border bg-paper/95 px-3 backdrop-blur">
      {/* leaving flushes the autosave; anything unsent stays in the outbox */}
      <Link
        href="/notebooks"
        className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-base text-ink-soft hover:bg-hover"
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
            className="w-full rounded-lg bg-sheet px-2 py-1 text-lg font-semibold outline-none ring-2 ring-accent/40"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="max-w-full truncate rounded-lg px-2 py-1 text-left text-lg font-semibold hover:bg-hover">
            {nb.title}
          </button>
        )}
        <div className="flex items-center gap-2 px-2 text-xs text-muted">
          <CasPill state={cas.state} />
          {demo && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-strong">{t('top.demo')}</span>}
          {mockAi && <span className="rounded-full bg-unknown-soft px-2 py-0.5 font-medium text-unknown">{t('top.mock')}</span>}
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-2xs font-bold text-accent">
            {APP_BUILD_VERSION}
          </span>
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
        <QuestionImportButton />
        <SaveStatus />
        <AccountMenu user={user} unsaved={dirty} />
      </div>
    </header>
  );
}

function CasPill({ state }: { state: string }) {
  const t = useT();
  return (
    <span className={clsx('inline-flex items-center gap-1', state === 'failed' ? 'text-danger' : state === 'ready' ? 'text-ok' : 'text-muted')}>
      {state === 'ready' ? <Cpu size={13} /> : state === 'failed' ? <CircleAlert size={13} /> : <Spinner size={12} />}
      {t(state === 'ready' ? 'top.checkerReady' : state === 'failed' ? 'top.checkerFailed' : 'top.checkerLoading')}
    </span>
  );
}
