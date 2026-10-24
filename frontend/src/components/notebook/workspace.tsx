'use client';

import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/core/api/client';
import { useSessionUser } from '@/core/auth/browser';
import { NotebookEngine } from '@/core/engine';
import { openNotebook } from '@/core/persistence/outbox';
import { RepoError } from '@/core/persistence/repo';
import { useNotebook } from '@/core/store/notebook-store';
import { ResourcesView } from '@/components/resources/resources-view';
import { currentLocale, translate, useT } from '@/i18n';
import { OrientationProvider } from '@/ui/orientation';
import { Spinner } from '@/ui/spinner';
import { Toast } from '@/ui/toast';
import { EngineContext } from './engine-context';
import { ExplanationSheet } from './explanation-sheet';
import { NotebookPage } from './notebook-page';
import { Toolbar } from './toolbar';
import { TopBar } from './top-bar';

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export function Workspace({ notebookId }: { notebookId: string }) {
  const t = useT();
  const { user, loading } = useSessionUser();
  const [engine, setEngine] = useState<NotebookEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mockAi, setMockAi] = useState(false);
  const tab = useNotebook((s) => s.tab);
  const loaded = useNotebook((s) => s.notebook?.id === notebookId);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let created: NotebookEngine | null = null;
    const tr = (k: string, v?: Record<string, string | number>) => translate(currentLocale(), k, v);
    openNotebook(userId, notebookId, (title) => tr('sync.copyTitle', { title }))
      .then((res) => {
        if (!alive) return;
        if (!res) {
          setError('not_found');
          return;
        }
        const s = useNotebook.getState();
        s.load(res.notebook, res.revision);
        // edits this device had not sent yet: autosave picks them up
        if (res.dirty) s.set('dirty', true);
        created = new NotebookEngine({ ownerId: userId, lang: currentLocale, t: tr });
        setEngine(created);
        if (res.offline) s.showToast(tr('sync.openedOffline'));
        else if (res.recoveredCopy) s.showToast(tr('sync.recoveredCopy', { title: res.recoveredCopy }));
      })
      .catch((e: Error) => alive && setError(e instanceof RepoError && e.code === 'MIGRATION_MISSING' ? tr('sync.migrationMissing') : e.message));
    api.capabilities().then((c) => alive && setMockAi(c.llm.mock), () => undefined);
    return () => {
      alive = false;
      created?.dispose();
      setEngine(null);
      useNotebook.getState().unload();
    };
  }, [userId, notebookId]);

  // save right away when switching to the resources tab (hiding the browser tab is handled by the autosave)
  useEffect(() => {
    if (!engine) return;
    if (tab === 'resources' && useNotebook.getState().dirty) {
      void engine.save();
    }
  }, [tab, engine]);

  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useNotebook.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab' && s.candidate?.state === 'READY') {
        e.preventDefault();
        const r = engine.adopt(s.ghostConfirm);
        s.set('ghostConfirm', r === 'confirm');
      } else if (e.key === 'Escape' && s.candidate && !s.sheet) {
        engine.reject();
        s.set('ghostConfirm', false);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        engine.redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void engine.save();
      } else if (mod && e.key === 'Enter' && s.activeLineId) {
        e.preventDefault();
        void engine.confirmLine(s.activeLineId);
      }
    };
    // unsent edits are kept on this device either way; warn only when the cloud is out of reach
    const onUnload = (e: BeforeUnloadEvent) => {
      const s = useNotebook.getState();
      if (engine.hasUnsent && (s.saveState === 'offline' || s.saveState === 'auth' || s.saveState === 'error' || s.saveState === 'conflict')) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [engine]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <AlertTriangle className="text-danger" />
        <p className="text-base text-ink-soft">{error === 'not_found' ? 'Notebook not found.' : error}</p>
        <Link href="/notebooks" className="text-accent underline">
          {t('top.notebooks')}
        </Link>
      </div>
    );
  }
  if (loading || !engine || !loaded) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }
  return (
    <EngineContext.Provider value={engine}>
      <OrientationProvider className="relative flex h-full flex-col overflow-hidden bg-paper">
        <TopBar mockAi={mockAi} user={user!} />
        <main className="relative min-h-0 flex-1">
          <div className={clsx('h-full w-full', tab === 'canvas' ? 'block' : 'hidden')}>
            <NotebookPage />
            <Toolbar />
          </div>
          <div className={clsx('h-full w-full', tab === 'resources' ? 'block' : 'hidden')}>
            {user && <ResourcesView ownerId={user.id} />}
          </div>
        </main>
        <ExplanationSheet />
        <Toast />
      </OrientationProvider>
    </EngineContext.Provider>
  );
}
