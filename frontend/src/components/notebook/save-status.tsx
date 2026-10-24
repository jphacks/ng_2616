'use client';

import clsx from 'clsx';
import { Check, CircleAlert, CloudOff, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { useEngine } from './engine-context';

/**
 * Autosave status in place of a Save button (ADR 0005). Tapping it saves now (or retries);
 * a conflict offers reloading the cloud version or keeping this one as a copy.
 */
export function SaveStatus() {
  const t = useT();
  const engine = useEngine();
  const state = useNotebook((s) => s.saveState);
  const dirty = useNotebook((s) => s.dirty);
  const error = useNotebook((s) => s.saveError);
  const [busy, setBusy] = useState(false);

  if (state === 'conflict') {
    const run = (fn: () => Promise<unknown>) => async () => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="flex items-center gap-1" aria-live="polite">
        <span className="text-sm text-danger">{t('top.conflict')}</span>
        <Button size="sm" disabled={busy} onClick={run(() => engine.reload())}>
          {t('top.reload')}
        </Button>
        <Button size="sm" disabled={busy} onClick={run(() => engine.saveAsCopy())}>
          {t('top.saveCopy')}
        </Button>
      </div>
    );
  }

  const view =
    state === 'saving'
      ? { icon: <Spinner size={14} />, label: t('sync.saving'), tone: 'text-muted' }
      : state === 'offline'
        ? { icon: <CloudOff size={15} aria-hidden />, label: t('sync.offline'), tone: 'text-ink-soft' }
        : state === 'auth'
          ? { icon: <KeyRound size={15} aria-hidden />, label: t('sync.auth'), tone: 'text-danger' }
          : state === 'error'
            ? { icon: <CircleAlert size={15} aria-hidden />, label: t('sync.error'), tone: 'text-danger' }
            : dirty
              ? { icon: <RefreshCw size={14} aria-hidden />, label: t('sync.pending'), tone: 'text-muted' }
              : { icon: <Check size={15} aria-hidden />, label: t('sync.saved'), tone: 'text-muted' };

  return (
    <button
      type="button"
      aria-label={view.label}
      aria-live="polite"
      onClick={() => void engine.save()}
      title={state === 'error' || state === 'auth' ? (error ?? view.label) : t('sync.saveNow')}
      className={clsx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm transition-colors hover:bg-hover outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        view.tone,
      )}
    >
      {view.icon}
      <span className="hidden sm:inline">{view.label}</span>
    </button>
  );
}
