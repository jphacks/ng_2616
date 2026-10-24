'use client';

import clsx from 'clsx';
import { Atom, FilePlus2, Info, Languages, LogOut, Sigma, Sparkles, SquareFunction, Trash2, Variable } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DEV_BYPASS, supabaseBrowser, useSessionUser } from '@/core/auth/browser';
import { deleteLocalNotebooks, getRepository, isCloudUnavailable, type NotebookSummary } from '@/core/persistence/repo';
import { buildNotebook, presetText, PRESET_IDS, SCHRODINGER_SHEET, type PresetId } from '@/core/presets';
import { deleteOwnerResources } from '@/core/resources/db';
import { addBuiltinResource } from '@/core/resources/service';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Spinner } from '@/ui/spinner';

const PRESET_ICON: Record<PresetId, typeof Atom> = { schrodinger: Atom, blank: FilePlus2, integral: Sigma, expansion: Variable, solutions: SquareFunction };

export function NotebookHome() {
  const t = useT();
  const router = useRouter();
  const { locale, setLocale } = useLocale();
  const { user, loading } = useSessionUser();
  const [items, setItems] = useState<NotebookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<PresetId | null>(null);
  const [local, setLocal] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const repo = getRepository(user.id);
      setItems(await repo.list());
      setLocal(repo.kind === 'local' || isCloudUnavailable());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const signOut = async () => {
    if (!user) return;
    // explicit sign-out clears this user's device data (spec §4.1); local-only notebooks are kept
    if (!isCloudUnavailable() && !DEV_BYPASS) {
      await deleteOwnerResources(user.id);
      await deleteLocalNotebooks(user.id);
    }
    if (!DEV_BYPASS) await supabaseBrowser().auth.signOut();
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-border bg-paper/95 px-6 backdrop-blur">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white">
          <Sigma size={19} />
        </span>
        <div className="flex-1">
          <div className="text-[16px] font-semibold">{t('app.name')}</div>
          <div className="text-[12px] text-muted">{user?.email}</div>
        </div>
        <Button variant="ghost" icon={<Languages size={18} />} onClick={() => setLocale(locale === 'en' ? 'ja' : 'en')}>
          {t('top.language')}
        </Button>
        <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void signOut()}>
          {t('home.signOut')}
        </Button>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-6 py-8">
        {(local || DEV_BYPASS) && (
          <p className="flex items-start gap-2 rounded-2xl bg-unknown-soft p-4 text-[14px] text-unknown">
            <Info size={18} className="mt-0.5 shrink-0" />
            {t(DEV_BYPASS ? 'home.devNotice' : 'home.localNotice')}
          </p>
        )}
        {error && <p className="rounded-2xl bg-wrong-soft p-4 text-[14px] text-wrong-strong">{t('home.loadFailed', { msg: error })}</p>}

        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{t('home.choose')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PRESET_IDS.map((id) => {
              const Icon = PRESET_ICON[id];
              const featured = id === 'schrodinger';
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!!creating}
                  onClick={() => void create(id)}
                  className={clsx(
                    'group flex min-h-36 flex-col items-start gap-3 rounded-3xl p-5 text-left transition',
                    featured ? 'bg-ink text-white shadow-float sm:col-span-2 lg:col-span-1' : 'bg-sheet shadow-card hover:-translate-y-0.5',
                  )}
                >
                  <span className={clsx('flex h-10 w-10 items-center justify-center rounded-xl', featured ? 'bg-white/15' : 'bg-accent-soft text-accent')}>
                    {creating === id ? <Spinner size={18} /> : <Icon size={20} />}
                  </span>
                  <span className="space-y-1">
                    <span className="flex items-center gap-2 text-[16px] font-semibold">
                      {presetText(id, locale).title}
                      {featured && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">
                          <Sparkles size={11} /> {t('home.demo')}
                        </span>
                      )}
                    </span>
                    <span className={clsx('block text-[13px] leading-snug', featured ? 'text-white/75' : 'text-muted')}>{t(`preset.${id}.desc`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{t('home.title')}</h2>
          {items === null ? (
            <div className="flex justify-center py-8 text-muted">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-border p-8 text-center text-[15px] text-muted">{t('home.empty')}</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-sheet shadow-card">
              {items.map((nb) => (
                <li key={nb.id} className="group flex min-h-16 items-center gap-3 px-5">
                  <button type="button" onClick={() => router.push(`/notebooks/${nb.id}`)} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 truncate text-[15px] font-medium">
                        {nb.title}
                        {nb.demo && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">{t('home.demo')}</span>}
                      </span>
                      <span className="block text-[12px] text-muted">{t('home.updated', { when: new Date(nb.updated_at).toLocaleString(locale) })}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={async () => {
                      if (!user || !window.confirm(t('home.deleteConfirm', { title: nb.title }))) return;
                      await getRepository(user.id).remove(nb.id);
                      void refresh();
                    }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-faint transition hover:bg-black/5 hover:text-wrong-strong"
                  >
                    <Trash2 size={17} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
