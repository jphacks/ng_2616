'use client';

import clsx from 'clsx';
import { ArrowDownUp, Atom, Info, Plus, Search, Sigma, Sparkles, SquareFunction, Variable, X } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEV_BYPASS, useSessionUser } from '@/core/auth/browser';
import { duplicateNotebook, renameNotebook } from '@/core/persistence/library';
import { pushAllPending } from '@/core/persistence/outbox';
import { getRepository, importDeviceNotebooks, isCloudUnavailable, RepoError, type NotebookSummary } from '@/core/persistence/repo';
import { arrange, useLibraryPrefs, type LibrarySort } from '@/core/prefs/library';
import { buildNotebook, presetText, PRESET_IDS, SCHRODINGER_SHEET, type PresetId } from '@/core/presets';
import { addBuiltinResource } from '@/core/resources/service';
import { useLocale, useT } from '@/i18n';
import { AccountMenu } from '@/components/account/account-menu';
import { Button } from '@/ui/button';
import { Menu, MenuPopup, MenuRadioItem } from '@/ui/menu';
import { Spinner } from '@/ui/spinner';
import { NotebookCardSkeleton } from './notebook-card';
import { NotebookGrid, type GridActions } from './notebook-grid';

const PRESET_ICON: Record<PresetId, typeof Atom> = { blank: Plus, schrodinger: Atom, integral: Sigma, expansion: Variable, solutions: SquareFunction };
const SORTS: LibrarySort[] = ['custom', 'updated', 'title'];
// a deleted card can be restored from the toast until this passes
const UNDO_MS = 5000;

export function NotebookHome() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();
  const { user, loading } = useSessionUser();
  const [items, setItems] = useState<NotebookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState<PresetId | null>(null);
  const [local, setLocal] = useState(false);
  const [query, setQuery] = useState('');
  const [deleted, setDeleted] = useState<NotebookSummary | null>(null);
  // card actions report failures at the bottom, where their feedback appears
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingDelete = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // cards stagger in on the first load only
  const [firstLoad, setFirstLoad] = useState(true);
  const prefs = useLibraryPrefs();

  useEffect(() => {
    if (user) prefs.init(user.id);
  }, [user, prefs]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const repo = getRepository(user.id);
      setItems(await repo.list());
      setLocal(repo.kind === 'local' || isCloudUnavailable());
    } catch (e) {
      setError(e instanceof RepoError && e.code === 'MIGRATION_MISSING' ? t('sync.migrationMissing') : e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, [user, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // notebooks an older build kept on this device, and edits not sent before the app closed
  useEffect(() => {
    if (!user || DEV_BYPASS) return;
    let alive = true;
    const copyTitle = (title: string) => t('sync.copyTitle', { title });
    void (async () => {
      const moved = await importDeviceNotebooks(user.id, copyTitle).catch(() => 0);
      const pushed = await pushAllPending(user.id, copyTitle).catch(() => []);
      const copies = pushed.filter((p) => p.kind === 'copied').length;
      const sent = moved + pushed.filter((p) => p.kind === 'saved').length;
      if (!alive || (!sent && !copies)) return;
      setSyncNotice(t(copies ? 'sync.uploadedWithCopies' : 'sync.uploadedFromDevice', { n: sent + copies, copies }));
      void refresh();
    })();
    return () => {
      alive = false;
    };
  }, [user, t, refresh]);

  useEffect(() => {
    if (items === null || !firstLoad) return;
    const id = setTimeout(() => setFirstLoad(false), 600);
    return () => clearTimeout(id);
  }, [items, firstLoad]);

  const commitDelete = useCallback(() => {
    const p = pendingDelete.current;
    if (!p || !user) return;
    clearTimeout(p.timer);
    pendingDelete.current = null;
    setDeleted(null);
    void getRepository(user.id)
      .remove(p.id)
      .then(refresh, (e: Error) => setActionError(t('home.actionFailed', { msg: e.message })));
  }, [user, refresh, t]);

  // leaving the page finishes a delete that is still waiting for Undo
  useEffect(() => {
    window.addEventListener('pagehide', commitDelete);
    return () => {
      window.removeEventListener('pagehide', commitDelete);
      commitDelete();
    };
  }, [commitDelete]);

  const visible = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLocaleLowerCase(locale);
    const shown = items.filter((n) => n.id !== deleted?.id && (!q || n.title.toLocaleLowerCase(locale).includes(q)));
    return arrange(shown, prefs, locale);
  }, [items, deleted, query, prefs, locale]);

  const create = async (id: PresetId) => {
    if (!user) return;
    setCreating(id);
    try {
      const nb = buildNotebook(id, locale);
      const res = await getRepository(user.id).save(nb, null);
      if (!res.ok) throw new Error(res.message ?? res.reason);
      if (id === 'schrodinger') {
        const sheet = SCHRODINGER_SHEET[locale];
        await addBuiltinResource(user.id, nb.id, sheet.name, 'problem_sheet', sheet.pages);
      }
      router.push(`/notebooks/${nb.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(null);
    }
  };

  const actions: GridActions = {
    open: (id) => router.push(`/notebooks/${id}`),
    rename: async (id, title) => {
      try {
        await renameNotebook(user!.id, id, title);
        await refresh();
      } catch (e) {
        return t('home.actionFailed', { msg: e instanceof Error ? e.message : String(e) });
      }
    },
    duplicate: async (id) => {
      try {
        const copy = await duplicateNotebook(user!.id, id, (title) => t('home.copyTitle', { title }));
        if (prefs.sort === 'custom' && visible) {
          // the copy sits right after its original
          const order = visible.map((n) => n.id);
          order.splice(order.indexOf(id) + 1, 0, copy);
          prefs.setOrder(order);
        }
        await refresh();
      } catch (e) {
        setActionError(t('home.actionFailed', { msg: e instanceof Error ? e.message : String(e) }));
      }
    },
    remove: (nb) => {
      commitDelete();
      setActionError(null);
      setDeleted(nb);
      pendingDelete.current = { id: nb.id, timer: setTimeout(commitDelete, UNDO_MS) };
    },
    reorder: (ids) => {
      prefs.setOrder(ids);
      if (prefs.sort !== 'custom') prefs.setSort('custom');
    },
  };

  const undoDelete = () => {
    if (pendingDelete.current) clearTimeout(pendingDelete.current.timer);
    pendingDelete.current = null;
    setDeleted(null);
  };

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="scrollbar-thin h-full overflow-y-auto">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-border bg-paper/95 px-6 pt-[env(safe-area-inset-top)] backdrop-blur">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sigma size={19} aria-hidden />
          </span>
          <h1 className="flex-1 text-[16px] font-semibold">{t('app.name')}</h1>
          <AccountMenu user={user} />
        </header>

        <main className="mx-auto max-w-5xl space-y-10 px-6 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {(local || DEV_BYPASS) && (
            <p className="flex items-start gap-2 rounded-2xl bg-unknown-soft p-4 text-[14px] text-unknown">
              <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
              {t(DEV_BYPASS ? 'home.devNotice' : 'home.localNotice')}
            </p>
          )}
          {syncNotice && (
            <p className="flex items-start gap-2 rounded-2xl bg-accent-soft p-4 text-[14px] text-accent-strong">
              <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
              <span className="flex-1">{syncNotice}</span>
              <button type="button" aria-label={t('common.close')} onClick={() => setSyncNotice(null)} className="-m-2 inline-flex size-9 items-center justify-center rounded-lg hover:bg-black/5">
                <X size={16} aria-hidden />
              </button>
            </p>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl bg-wrong-soft p-4 text-[14px] text-wrong-strong">
              <span className="flex-1">{t('home.loadFailed', { msg: error })}</span>
              <button type="button" aria-label={t('common.close')} onClick={() => setError(null)} className="-m-2 inline-flex size-9 items-center justify-center rounded-lg hover:bg-black/5">
                <X size={16} aria-hidden />
              </button>
            </p>
          )}

          <section className="space-y-4">
            <h2 className="text-[13px] font-semibold text-balance uppercase tracking-wide text-muted">{t('home.choose')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {PRESET_IDS.map((id) => (
                <PresetCard key={id} id={id} busy={creating === id} disabled={!!creating} onCreate={() => void create(id)} />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-[13px] font-semibold text-balance uppercase tracking-wide text-muted">{t('home.title')}</h2>
              <SearchField value={query} onChange={setQuery} />
              <SortMenu value={prefs.sort} onChange={prefs.setSort} />
            </div>
            {visible === null ? (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label={t('common.loading')}>
                {Array.from({ length: 4 }, (_, i) => (
                  <NotebookCardSkeleton key={i} />
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border p-8 text-center">
                <p className="text-[15px] text-pretty text-muted">{query.trim() ? t('home.noMatches', { q: query.trim() }) : t('home.empty')}</p>
                {query.trim() ? (
                  <Button variant="secondary" icon={<X size={16} aria-hidden />} onClick={() => setQuery('')}>
                    {t('home.clearSearch')}
                  </Button>
                ) : (
                  <Button variant="primary" icon={creating === 'blank' ? <Spinner /> : <Plus size={17} aria-hidden />} disabled={!!creating} onClick={() => void create('blank')}>
                    {t('home.new')}
                  </Button>
                )}
              </div>
            ) : (
              <NotebookGrid items={visible} reorderable={!query.trim()} stagger={firstLoad} actions={actions} />
            )}
          </section>
        </main>

        <AnimatePresence>
          {actionError && !deleted && (
            <motion.div
              key="error"
              role="alert"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-4 rounded-2xl bg-wrong-strong py-2 pr-2 pl-4 text-[15px] text-white shadow-float"
            >
              <span className="text-pretty">{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} className="min-h-10 shrink-0 rounded-xl px-3 font-semibold hover:bg-white/10">
                {t('home.dismiss')}
              </button>
            </motion.div>
          )}
          {deleted && (
            <motion.div
              key={deleted.id}
              role="status"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-4 rounded-2xl bg-ink py-2 pr-2 pl-4 text-[15px] text-white shadow-float"
            >
              <span className="truncate">{t('home.deleted', { title: deleted.title })}</span>
              <button type="button" onClick={undoDelete} className="min-h-10 shrink-0 rounded-xl px-3 font-semibold text-accent-soft hover:bg-white/10">
                {t('home.undo')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function PresetCard({ id, busy, disabled, onCreate }: { id: PresetId; busy: boolean; disabled: boolean; onCreate: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const Icon = PRESET_ICON[id];
  const primary = id === 'blank';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCreate}
      className={clsx(
        'flex min-h-32 flex-col items-start gap-3 rounded-3xl p-4 text-left transition-transform duration-150 active:scale-[0.98] disabled:cursor-not-allowed',
        primary ? 'border border-dashed border-accent/40 bg-accent-soft/40 hover:bg-accent-soft/70' : 'bg-sheet shadow-card hover:-translate-y-0.5',
      )}
    >
      <span className={clsx('flex size-9 items-center justify-center rounded-xl', primary ? 'bg-accent text-white' : 'bg-accent-soft text-accent')}>
        {busy ? <Spinner size={18} /> : <Icon size={19} aria-hidden />}
      </span>
      <span className="space-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-snug font-semibold">
          {presetText(id, locale).title}
          {id === 'schrodinger' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
              <Sparkles size={11} aria-hidden /> {t('home.demo')}
            </span>
          )}
        </span>
        <span className="line-clamp-2 block text-[13px] leading-snug text-pretty text-muted">{t(`preset.${id}.desc`)}</span>
      </span>
    </button>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <label className="relative flex min-w-0 flex-1 items-center sm:max-w-72 sm:flex-none">
      <Search size={17} aria-hidden className="pointer-events-none absolute left-3 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={t('home.search')}
        aria-label={t('home.search')}
        className="min-h-11 w-full rounded-xl bg-sheet pr-11 pl-9 text-[15px] shadow-card outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label={t('home.clearSearch')} onClick={() => onChange('')} className="absolute right-0 inline-flex size-11 items-center justify-center text-muted hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      )}
    </label>
  );
}

function SortMenu({ value, onChange }: { value: LibrarySort; onChange: (v: LibrarySort) => void }) {
  const t = useT();
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-[14px] font-medium text-ink-soft outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent/50 data-popup-open:bg-black/5">
        <ArrowDownUp size={16} aria-hidden />
        {t(`home.sort.${value}`)}
      </Menu.Trigger>
      <MenuPopup>
        <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as LibrarySort)}>
          {SORTS.map((s) => (
            <MenuRadioItem key={s} value={s}>
              {t(`home.sort.${s}`)}
            </MenuRadioItem>
          ))}
        </Menu.RadioGroup>
      </MenuPopup>
    </Menu.Root>
  );
}

