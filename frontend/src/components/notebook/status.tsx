'use client';

import { leanOf, type Line, type LineLean } from '@mn/contracts';
import clsx from 'clsx';
import { CircleCheck, CircleDashed, CircleHelp, CircleMinus, CircleX } from 'lucide-react';
import { proofOf } from '@/core/notebook/model';
import { useT } from '@/i18n';

export type Tone = 'ok' | 'local' | 'wrong' | 'unknown' | 'none';

/** Lean's verdict on a proof line (ADR 0007): never "wrong", since an unproved step is not a false one. */
function leanTone(lean: LineLean): Tone {
  if (lean.step === 'ok') return lean.after_failure ? 'local' : 'ok';
  // "so the formula holds, which completes the proof": nothing new, but the proof is done
  if (lean.step === 'empty') return lean.proof === 'proved' ? 'ok' : 'none';
  return 'unknown';
}

function leanLabel(lean: LineLean): string {
  switch (lean.step) {
    case 'ok':
      return lean.after_failure ? 'status.leanAfterFailure' : lean.proof === 'proved' ? 'status.leanProved' : 'status.leanStep';
    case 'empty':
      return lean.proof === 'proved' ? 'status.leanProved' : 'status.leanEmpty';
    case 'failed':
      return 'status.leanFailed';
    case 'unchecked':
      return 'status.leanUnchecked';
  }
  return lean.proof === 'unavailable' ? 'status.leanUnavailable' : lean.proof === 'timeout' ? 'status.leanTimeout' : 'status.leanInvalid';
}

export function toneOf(line: Line): Tone | null {
  const lean = leanOf(line);
  if (lean?.proof) return leanTone(lean);
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
  return (line: Line, ancestor: number | null): { label: string; detail?: string } => {
    const lean = leanOf(line);
    if (lean?.proof) {
      const why = lean.step === 'ok' || lean.step === 'empty' ? undefined : lean.message?.split('\n')[0]?.slice(0, 160);
      return { label: t(leanLabel(lean)), ...(why ? { detail: why } : {}) };
    }
    const p = proofOf(line);
    if (!p) return { label: '' };
    switch (p.status) {
      case 'ok':
        if (p.unverified_ancestors.length) return { label: t('status.local', { n: ancestor ?? '?' }) };
        return { label: t('status.verified') };
      case 'wrong':
        return { label: t(`cat.${p.category ?? 'UNCLASSIFIED'}`) };
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
  const { label: text, detail } = label(line, ancestor);
  const Icon = ICON[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-left text-sm font-medium transition-opacity hover:opacity-85', TONE_CLASS[tone])}
      title={detail ? `${text} · ${detail}` : text}
      data-status={tone}
    >
      <Icon size={16} className="shrink-0" aria-hidden />
      <span className={clsx('truncate', compact && 'max-w-24')}>{text}</span>
    </button>
  );
}
