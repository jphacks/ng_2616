'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { activity, subjects, totals } from '@/core/insights/aggregate';
import { localDay } from '@/core/insights/stats';
import { insightsFor, type NotebookInsight } from '@/core/insights/store';
import type { NotebookSummary } from '@/core/persistence/repo';
import { useT } from '@/i18n';
import { StatsPanel } from './stats-panel';
import { SubjectCloud } from './subject-cloud';

/**
 * The home page's progress section: the subjects the student works on (left) and what the
 * notebook did for them (right). Tapping a subject narrows both columns to its notebooks.
 */
export function ProgressSection({ ownerId, notebooks }: { ownerId: string; notebooks: NotebookSummary[] }) {
  const t = useT();
  const [rows, setRows] = useState<NotebookInsight[] | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  useEffect(() => {
    const recorder = insightsFor(ownerId);
    let alive = true;
    const show = (r: NotebookInsight[]) => alive && setRows(r);
    void recorder.refresh().then(show);
    const off = recorder.subscribe(() => void recorder.all().then(show));
    return () => {
      alive = false;
      off();
    };
  }, [ownerId]);

  // notebooks saved before insights existed are counted here, without opening them
  useEffect(() => {
    void insightsFor(ownerId).backfill(notebooks);
  }, [ownerId, notebooks]);

  const live = useMemo(() => {
    const ids = new Set(notebooks.map((n) => n.id));
    return (rows ?? []).filter((r) => ids.has(r.notebook_id));
  }, [rows, notebooks]);
  const all = useMemo(() => subjects(live), [live]);
  // a subject whose last notebook was deleted stops filtering
  const active = subject && all.some((s) => s.tag === subject) ? subject : null;
  const picked = useMemo(() => (active ? live.filter((r) => r.tags.includes(active)) : live), [live, active]);
  const sums = useMemo(() => totals(picked), [picked]);
  const days = useMemo(() => activity(picked), [picked]);

  if (rows === null) return null;

  return (
    <section className="space-y-4" aria-labelledby="progress-title">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="progress-title" className="flex-1 text-3xl font-semibold text-balance">
          {t('progress.title')}
        </h2>
        {active && (
          <button
            type="button"
            onClick={() => setSubject(null)}
            aria-label={t('progress.clearFilter', { tag: active })}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent-soft py-1.5 pr-2.5 pl-3.5 text-md font-medium text-accent-strong hover:bg-accent-soft/70"
          >
            {t('progress.filter', { tag: active })}
            <X size={15} aria-hidden />
          </button>
        )}
      </div>
      {live.length === 0 ? (
        <p className="rounded-3xl bg-sheet p-6 text-base text-pretty text-muted shadow-card">{t('progress.empty')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0 rounded-3xl bg-sheet p-5 shadow-card">
            <h3 className="mb-3 text-sm font-medium text-muted">{t('progress.subjects')}</h3>
            {all.length ? (
              <SubjectCloud subjects={all} selected={active} onSelect={setSubject} />
            ) : (
              <p className="flex min-h-40 items-center justify-center text-center text-base text-pretty text-muted">{t('progress.noSubjects')}</p>
            )}
          </div>
          <div className="min-w-0 rounded-3xl bg-sheet p-5 shadow-card">
            <StatsPanel totals={sums} days={days} today={localDay(new Date())} />
          </div>
        </div>
      )}
    </section>
  );
}
