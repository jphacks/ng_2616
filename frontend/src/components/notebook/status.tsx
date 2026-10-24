'use client';

import type { Line } from '@mn/contracts';
import clsx from 'clsx';
import { CircleCheck, CircleDashed, CircleHelp, CircleMinus, CircleX } from 'lucide-react';
import { proofOf } from '@/core/notebook/model';
import { useT } from '@/i18n';

export type Tone = 'ok' | 'local' | 'wrong' | 'unknown' | 'none';

export function toneOf(line: Line): Tone | null {
  const p = proofOf(line);
  if (!p) return null;
  if (p.status === 'ok') return p.unverified_ancestors.length ? 'local' : 'ok';
  return p.status;
}

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  local: 'bg-ok-soft text-ok',
  wrong: 'bg-wrong-soft text-wrong-strong',
  unknown: 'bg-unknown-soft text-unknown',
  none: 'bg-none-soft text-none',
};

const ICON: Record<Tone, typeof CircleCheck> = { ok: CircleCheck, local: CircleDashed, wrong: CircleX, unknown: CircleHelp, none: CircleMinus };

const NONE_LABEL: Record<string, string> = {
  DEFINITION: 'status.definition',
  PREMISE: 'status.premise',
  ASSUMPTION: 'status.assumption',
  FUNCTION: 'status.function',
  DECLARATION: 'status.declaration',
  TEXT_ONLY: 'status.text',
};

export function useStatusLabel() {
  const t = useT();
  /** `ancestor` is the visible number of the first unverified line this one depends on. */
  return (line: Line, ancestor: number | null): { label: string; detail?: string; baseLabel?: string; ancestorPill?: string } => {
    const p = proofOf(line);
    if (!p) return { label: '' };
    switch (p.status) {
      case 'ok':
        if (p.unverified_ancestors.length) {
          const ancText = ancestor !== null ? String(ancestor) : '?';
          return {
            label: t('status.local', { n: ancText }),
            baseLabel: t('status.localBase'),
            ancestorPill: t('status.ancestorPill', { n: ancText }),
          };
        }
        return { label: t('status.verified') };
      case 'wrong': {
        const catLabel = t(`cat.${p.category ?? 'UNCLASSIFIED'}`);
        if (p.unverified_ancestors.length) {
          const ancText = ancestor !== null ? String(ancestor) : '?';
          return {
            label: `${catLabel} (${t('status.ancestorPill', { n: ancText })})`,
            baseLabel: catLabel,
            ancestorPill: t('status.ancestorPill', { n: ancText }),
          };
        }
        return { label: catLabel };
      }
      case 'unknown':
        return { label: t(p.reason === 'UNPARSED' ? 'status.notCheckable' : 'status.unknown'), detail: p.reason ? t(`reason.${p.reason}`) : undefined };
      case 'none':
        return {
          label: t(
            NONE_LABEL[p.reason ?? ''] ?? 'status.first',
          ),
        };
    }
  };
}

/** Status uses colour + icon + text together (spec §8.1, Q-12). */
export function StatusBadge({ line, ancestor, onClick, compact }: { line: Line; ancestor: number | null; onClick?: () => void; compact?: boolean }) {
  const label = useStatusLabel();
  const tone = toneOf(line);
  if (!tone) return null;
  const { label: text, detail, baseLabel, ancestorPill } = label(line, ancestor);
  const Icon = ICON[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-left text-sm font-medium transition-all hover:opacity-90 active:scale-98 shadow-sm',
        TONE_CLASS[tone]
      )}
      title={detail ? `${text} · ${detail}` : text}
      data-status={tone}
    >
      <Icon size={16} className="shrink-0" aria-hidden />
      {baseLabel && ancestorPill && !compact ? (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="truncate">{baseLabel}</span>
          <span className="inline-flex items-center rounded-full bg-unknown/20 text-unknown-strong border border-unknown/30 px-1.5 py-0.2 text-2xs font-semibold whitespace-nowrap">
            {ancestorPill}
          </span>
        </span>
      ) : (
        <span className={clsx('truncate', compact && 'max-w-24')}>{text}</span>
      )}
    </button>
  );
}
