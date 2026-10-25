'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { addDays, streak, type Totals } from '@/core/insights/aggregate';
import { useLocale, useT } from '@/i18n';

/** About four and a half months of days, a column per week. */
const WEEKS = 20;

/** The numbers beside the subject cloud: how many lines were written, and on which days. */
export function StatsPanel({ totals, days, today }: { totals: Totals; days: ReadonlyMap<string, number>; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  const fmt = (n: number) => n.toLocaleString(locale);
  const own = totals.lines - totals.ai_lines;
  const aiShare = totals.lines ? Math.round((totals.ai_lines / totals.lines) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-muted">{t('progress.lines')}</p>
        <p className="text-figure leading-none font-semibold">{fmt(totals.lines)}</p>
        {totals.lines > 0 && (
          <>
            {/* you vs. the assistant: the assistant's share is the one in color */}
            <div className="mt-3 flex h-2.5 gap-0.5" aria-hidden>
              {own > 0 && <span className="rounded-l-sm bg-fill-strong last:rounded-r-sm" style={{ flexGrow: own }} />}
              {totals.ai_lines > 0 && <span className="rounded-r-sm bg-accent first:rounded-l-sm" style={{ flexGrow: totals.ai_lines }} />}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
              <Key swatch="bg-fill-strong">{t('progress.linesYou', { n: fmt(own) })}</Key>
              <Key swatch="bg-accent">{t('progress.linesAi', { n: fmt(totals.ai_lines), pct: aiShare })}</Key>
            </ul>
            {totals.ai_lines > 0 && (
              <p className="mt-1 text-sm text-muted">
                {t('progress.aiModes', { rhs: fmt(totals.ai_modes.COMPLETE_RHS), next: fmt(totals.ai_modes.NEXT_STEP) })}
              </p>
            )}
          </>
        )}
      </div>

      <Activity days={days} today={today} />
    </div>
  );
}

function Key({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className={clsx('size-2.5 rounded-sm', swatch)} />
      {children}
    </li>
  );
}

/** Notebooks saved on a day, binned: none, one, two, three or more. */
const HEAT = ['bg-fill-strong', 'bg-accent/35', 'bg-accent/65', 'bg-accent'] as const;

function Activity({ days, today }: { days: ReadonlyMap<string, number>; today: string }) {
  const t = useT();
  const { locale } = useLocale();
  // columns are weeks ending with this one; rows run Sunday to Saturday
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -(WEEKS - 1) * 7 - weekday);
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i));
  let active = 0;
  for (const d of cells) if (days.has(d)) active += 1;
  const run = streak(days, today);
  const dateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="flex-1 text-sm font-medium text-muted">{t('progress.activity')}</p>
        <p className="text-sm text-ink-soft">
          {t('progress.streak', { n: run })} · {active === 1 ? t('progress.activeDayOne') : t('progress.activeDays', { n: active })}
        </p>
      </div>
      <div className="mt-2 grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }} role="img" aria-label={t('progress.activityLabel', { n: active, weeks: WEEKS })}>
        {cells.map((d) => {
          const n = days.get(d) ?? 0;
          const future = d > today;
          return (
            <span
              key={d}
              title={future ? undefined : t('progress.day', { date: dateFmt.format(new Date(`${d}T12:00:00Z`)), n })}
              className={clsx('aspect-square rounded-[3px]', future ? 'bg-transparent' : HEAT[Math.min(n, 3)])}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-muted" aria-hidden>
        {t('progress.less')}
        {HEAT.map((c) => (
          <span key={c} className={clsx('size-2.5 rounded-[3px]', c)} />
        ))}
        {t('progress.more')}
      </div>
    </div>
  );
}
