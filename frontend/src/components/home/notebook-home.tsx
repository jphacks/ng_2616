'use client';

import clsx from 'clsx';
import { ArrowDownUp, Atom, Copy, Info, Infinity as InfinityIcon, PenLine, Plus, RefreshCw, Search, Sigma, SquareFunction, Trash2, Variable, X, type LucideProps } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { DEV_BYPASS, useSessionUser } from '@/core/auth/browser';
import { duplicateNotebook, renameNotebook } from '@/core/persistence/library';
import { pushAllPending } from '@/core/persistence/outbox';
import { getRepository, importDeviceNotebooks, isCloudUnavailable, RepoError, type NotebookSummary } from '@/core/persistence/repo';
import { arrange, useLibraryPrefs, type LibrarySort } from '@/core/prefs/library';
import { buildNotebook, PRESET_IDS, SCHRODINGER_SHEET, type PresetId } from '@/core/presets';
import { addBuiltinResource } from '@/core/resources/service';
import { useLocale, useT } from '@/i18n';
import { AccountMenu } from '@/components/account/account-menu';
import { Button } from '@/ui/button';
import { IntegralIcon } from '@/ui/icons';
import { Menu, MenuPopup, MenuRadioItem } from '@/ui/menu';
import { Shelf } from '@/ui/shelf';
import { Spinner } from '@/ui/spinner';
import { NotebookCardSkeleton } from './notebook-card';
import { NotebookGrid, type GridActions } from './notebook-grid';
import { PULL_THRESHOLD, usePullToRefresh } from './use-pull-refresh';
import { enter } from '@/ui/motion';

const PRESET_ICON: Record<PresetId, ComponentType<LucideProps>> = {
  blank: Plus,
  schrodinger: Atom,
  integral: IntegralIcon,
  expansion: Variable,
  solutions: SquareFunction,
  induction: Sigma,
  epsilon_delta: InfinityIcon,
};
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
  const [deleted, setDeleted] = useState<NotebookSummary[]>([]);
  // selection mode: which cards are picked, or null when not selecting
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // card actions report failures at the bottom, where their feedback appears
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingDelete = useRef<{ ids: string[]; timer: ReturnType<typeof setTimeout> } | null>(null);
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
    setDeleted([]);
    const repo = getRepository(user.id);
    void Promise.all(p.ids.map((id) => repo.remove(id))).then(refresh, (e: Error) => {
      setActionError(t('home.actionFailed', { msg: e.message }));
      void refresh();
    });
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
    const hidden = new Set(deleted.map((n) => n.id));
    const shown = items.filter((n) => !hidden.has(n.id) && (!q || n.title.toLocaleLowerCase(locale).includes(q)));
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
    duplicate: (id) => void duplicateMany([id]),
    remove: (nb) => removeMany([nb]),
    reorder: (ids) => {
      prefs.setOrder(ids);
      if (prefs.sort !== 'custom') prefs.setSort('custom');
    },
    select: (id) => setSelected(new Set([id])),
    toggle: (id) =>
      setSelected((s) => {
        const next = new Set(s);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
  };

  // each copy sits right after its original
  async function duplicateMany(ids: string[]) {
    try {
      const order = visible?.map((n) => n.id) ?? [];
      for (const id of ids) {
        const copy = await duplicateNotebook(user!.id, id, (title) => t('home.copyTitle', { title }));
        order.splice(order.indexOf(id) + 1, 0, copy);
      }
      if (prefs.sort === 'custom') prefs.setOrder(order);
    } catch (e) {
      setActionError(t('home.actionFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
    await refresh();
  }

  function removeMany(nbs: NotebookSummary[]) {
    commitDelete();
    setActionError(null);
    setDeleted(nbs);
    pendingDelete.current = { ids: nbs.map((n) => n.id), timer: setTimeout(commitDelete, UNDO_MS) };
  }

  const picked = visible?.filter((n) => selected?.has(n.id)) ?? [];

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const { pull, refreshing } = usePullToRefresh(scroller, refresh);

  const undoDelete = () => {
    if (pendingDelete.current) clearTimeout(pendingDelete.current.timer);
    pendingDelete.current = null;
    setDeleted([]);
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
      <div ref={scroller} className="scrollbar-thin relative h-full overflow-y-auto overscroll-y-contain">
        {(pull > 0 || refreshing) && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-16 z-lifted flex justify-center">
            <span
              className="mt-2 flex size-9 items-center justify-center rounded-full bg-sheet text-accent shadow-float"
              style={{ transform: `translateY(${refreshing ? PULL_THRESHOLD / 2 : pull / 2}px)`, opacity: refreshing ? 1 : Math.min(1, pull / PULL_THRESHOLD) }}
            >
              {refreshing ? <Spinner size={16} /> : <RefreshCw size={16} style={{ transform: `rotate(${pull * 3}deg)` }} />}
            </span>
          </div>
        )}
        <header className="sticky top-0 z-sticky flex min-h-16 items-center gap-3 border-b border-border bg-paper/95 px-6 pt-[env(safe-area-inset-top)] backdrop-blur">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sigma size={19} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{t('app.name')}</h1>
            {(local || DEV_BYPASS) && (
              <span
                title={t(DEV_BYPASS ? 'home.devNotice' : 'home.localNotice')}
                className="inline-flex min-w-0 items-center gap-1 rounded-full bg-unknown-soft px-2.5 py-1 text-xs font-medium text-unknown"
              >
                <Info size={13} className="shrink-0" aria-hidden />
                <span className="truncate">{t(DEV_BYPASS ? 'home.devChip' : 'home.localChip')}</span>
                <span className="sr-only">{t(DEV_BYPASS ? 'home.devNotice' : 'home.localNotice')}</span>
              </span>
            )}
          </div>
          <AccountMenu user={user} />
        </header>

        <main className={clsx('mx-auto max-w-5xl space-y-10 px-6 py-8', selected ? 'pb-28' : 'pb-[max(2rem,env(safe-area-inset-bottom))]')}>
          {syncNotice && (
            <p className="flex items-start gap-2 rounded-2xl bg-accent-soft p-4 text-md text-accent-strong">
              <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
              <span className="flex-1">{syncNotice}</span>
              <button type="button" aria-label={t('common.close')} onClick={() => setSyncNotice(null)} className="-m-2 inline-flex size-9 items-center justify-center rounded-lg hover:bg-hover">
                <X size={16} aria-hidden />
              </button>
            </p>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft p-4 text-md text-danger">
              <span className="flex-1">{t('home.loadFailed', { msg: error })}</span>
              <button type="button" aria-label={t('common.close')} onClick={() => setError(null)} className="-m-2 inline-flex size-9 items-center justify-center rounded-lg hover:bg-hover">
                <X size={16} aria-hidden />
              </button>
            </p>
          )}

          <section className="space-y-4">
            <h2 className="text-3xl font-semibold text-balance">{t('home.choose')}</h2>
            {/* a swipeable shelf: the cut-off card at the edge hints there are more */}
            <Shelf className="-mx-6 scroll-px-6 gap-3 px-6 pb-1" prevLabel={t('home.shelfPrev')} nextLabel={t('home.shelfNext')}>
              {PRESET_IDS.map((id) => (
                <PresetCard key={id} id={id} busy={creating === id} disabled={!!creating} onCreate={() => void create(id)} />
              ))}
            </Shelf>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-3xl font-semibold text-balance">{t('home.title')}</h2>
              <SearchField value={query} onChange={setQuery} />
              <SortMenu value={prefs.sort} onChange={prefs.setSort} />
            </div>
            {visible === null ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t('common.loading')}>
                {Array.from({ length: 3 }, (_, i) => (
                  <NotebookCardSkeleton key={i} />
                ))}
              </ul>
            ) : visible.length === 0 ? (
              query.trim() ? (
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <p className="text-base text-pretty text-muted">{t('home.noMatches', { q: query.trim() })}</p>
                  <Button variant="secondary" icon={<X size={16} aria-hidden />} onClick={() => setQuery('')}>
                    {t('home.clearSearch')}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-5 py-12 text-center">
                  <span className="flex size-20 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <PenLine size={36} strokeWidth={1.75} aria-hidden />
                  </span>
                  <p className="text-2xl font-semibold text-balance">{t('home.empty')}</p>
                  <Button variant="primary" size="lg" icon={creating === 'blank' ? <Spinner /> : <Plus size={18} aria-hidden />} disabled={!!creating} onClick={() => void create('blank')}>
                    {t('preset.blank.action')}
                  </Button>
                </div>
              )
            ) : (
              <NotebookGrid items={visible} reorderable={!query.trim()} stagger={firstLoad} selected={selected} actions={actions} />
            )}
          </section>
        </main>

        <AnimatePresence>
          {selected && (
            <motion.div
              key="selection"
              role="toolbar"
              aria-label={t('home.selected', { n: picked.length })}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={enter}
              className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-overlay mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-2xl bg-sheet p-1.5 shadow-float"
            >
              <button type="button" aria-label={t('home.doneSelecting')} onClick={() => setSelected(null)} className="inline-flex size-10 items-center justify-center rounded-xl text-ink-soft hover:bg-hover">
                <X size={18} aria-hidden />
              </button>
              <span className="min-w-24 px-1 text-base font-medium tabular-nums">{t('home.selected', { n: picked.length })}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(visible?.map((n) => n.id)))}>
                {t('home.selectAll')}
              </Button>
              <Button
                size="sm"
                icon={<Copy size={15} aria-hidden />}
                disabled={!picked.length}
                onClick={() => {
                  setSelected(null);
                  void duplicateMany(picked.map((n) => n.id));
                }}
              >
                {t('home.duplicate')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={15} aria-hidden />}
                disabled={!picked.length}
                onClick={() => {
                  setSelected(null);
                  removeMany(picked);
                }}
              >
                {t('common.delete')}
              </Button>
            </motion.div>
          )}
          {actionError && !deleted.length && !selected && (
            <motion.div
              key="error"
              role="alert"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={enter}
              className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-overlay mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-4 rounded-2xl bg-danger py-2 pr-2 pl-4 text-base text-on-solid shadow-float"
            >
              <span className="text-pretty">{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} className="min-h-10 shrink-0 rounded-xl px-3 font-semibold hover:bg-on-solid/10">
                {t('home.dismiss')}
              </button>
            </motion.div>
          )}
          {deleted.length > 0 && !selected && (
            <motion.div
              key={deleted.map((n) => n.id).join()}
              role="status"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={enter}
              className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-overlay mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-4 rounded-2xl bg-ink py-2 pr-2 pl-4 text-base text-on-solid shadow-float"
            >
              <span className="truncate">{deleted.length === 1 ? t('home.deleted', { title: deleted[0]!.title }) : t('home.deletedMany', { n: deleted.length })}</span>
              <button type="button" onClick={undoDelete} className="min-h-10 shrink-0 rounded-xl px-3 font-semibold text-accent-soft hover:bg-on-solid/10">
                {t('home.undo')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

/**
 * A starting point: a solid accent card with its icon drawn large behind a big action title.
 * "New empty notebook" uses the deeper accent as the screen's main action.
 */
function PresetCard({ id, busy, disabled, onCreate }: { id: PresetId; busy: boolean; disabled: boolean; onCreate: () => void }) {
  const t = useT();
  const Icon = PRESET_ICON[id];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCreate}
      className={clsx(
        '@container group relative flex aspect-[5/4] w-[64%] shrink-0 snap-start overflow-hidden rounded-3xl p-5 text-left shadow-card',
        'transition-transform duration-fast active:scale-[0.97] disabled:cursor-not-allowed motion-reduce:transition-none sm:w-[38%] lg:w-[26%]',
        id === 'blank' ? 'bg-accent-deep' : 'bg-accent',
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.5}
        className={clsx(
          'absolute top-4 right-4 h-[calc(100%-2rem)] w-auto transition-transform duration-fast group-active:-translate-y-1 group-active:-rotate-6 motion-reduce:transition-none',
          id === 'blank' ? 'text-accent-deep-shade' : 'text-accent-shade',
        )}
      />
      {busy && <Spinner size={20} className="absolute top-4 left-4 text-on-solid" />}
      <span className="relative mt-auto text-display leading-tight font-semibold text-balance text-on-solid">{t(`preset.${id}.action`)}</span>
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
        className="min-h-11 w-full rounded-xl bg-sheet pr-11 pl-9 text-base shadow-card outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/40 [&::-webkit-search-cancel-button]:hidden"
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
      <Menu.Trigger className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-md font-medium text-ink-soft outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50 data-popup-open:bg-hover">
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
