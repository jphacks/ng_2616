'use client';

import clsx from 'clsx';
import { Check, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useNotebook, type Candidate } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Spinner } from '@/ui/spinner';
import { useEngine } from './engine-context';
import { Segments } from './segments';

/**
 * The AI's proposal as a faded line (Cursor-style). Tab or a tap adopts it; adoption is an
 * explicit, single-use, undoable command. Unverified proposals are amber and need a second
 * confirmation (ADR 0003).
 */
export function GhostLine({ candidate }: { candidate: Candidate }) {
  const t = useT();
  const engine = useEngine();
  const confirming = useNotebook((s) => s.ghostConfirm);
  const setConfirm = (v: boolean) => useNotebook.getState().set('ghostConfirm', v);

  if (candidate.state === 'GENERATING' || candidate.state === 'VERIFYING') {
    return (
      <div className="shimmer flex min-h-14 items-center gap-2 rounded-2xl px-4 text-base text-accent">
        <Spinner />
        {t(candidate.state === 'GENERATING' ? 'ghost.generating' : 'ghost.checking')}
      </div>
    );
  }
  if (candidate.state !== 'READY') return null;

  const unverified = candidate.policy === 'unverified';
  const reason = candidate.lines.find((l) => l.verified?.proof.status === 'unknown')?.verified?.proof.reason;
  const label =
    candidate.policy === 'verified' ? t('ghost.verified') : candidate.policy === 'assumption' ? t('ghost.assumption') : t('ghost.unverified', { reason: t(`reason.${reason ?? 'NO_EVIDENCE'}`) });

  const accept = () => {
    const r = engine.adopt(confirming);
    if (r === 'confirm') setConfirm(true);
    else setConfirm(false);
  };

  return (
    <div
      className={clsx(
        'ghost animate-rise rounded-2xl border border-dashed px-4 py-3',
        unverified ? 'border-unknown/50 bg-unknown-soft/70' : 'border-accent/40 bg-accent-soft/60',
      )}
    >
      <div className={clsx('mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide', unverified ? 'text-unknown' : 'text-accent')}>
        {unverified ? <ShieldAlert size={14} /> : <Sparkles size={14} />}
        {label}
      </div>
      <button type="button" onClick={accept} className="block w-full text-left opacity-70 transition-opacity hover:opacity-100">
        {candidate.lines.map((l, i) => (
          <Segments key={i} segments={l.segments} />
        ))}
      </button>
      {confirming && unverified && <p className="mt-2 text-md text-unknown">{t('ghost.confirmUnverified')}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={accept}
          className={clsx(
            'inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-medium text-on-solid',
            unverified ? 'bg-unknown hover:bg-unknown/90' : 'bg-accent hover:bg-accent-strong',
          )}
        >
          <Check size={18} />
          {unverified ? (confirming ? t('ghost.adoptUnverified') : t('ghost.accept')) : t('ghost.accept')}
          <kbd className="rounded-md bg-on-solid/20 px-1.5 text-xs">{t('ghost.acceptHint')}</kbd>
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirm(false);
            engine.reject();
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-base text-muted hover:bg-hover"
        >
          <X size={18} /> {t('ghost.reject')}
        </button>
      </div>
    </div>
  );
}

export function RejectionChip() {
  const t = useT();
  const rejection = useNotebook((s) => s.rejection);
  if (!rejection) return null;
  return (
    <button
      type="button"
      onClick={() => useNotebook.getState().set('sheet', { kind: 'rejection' })}
      className="mb-2 inline-flex min-h-9 animate-rise items-center gap-2 rounded-full bg-wrong-soft px-3 text-sm font-medium text-wrong-strong hover:opacity-85"
    >
      <ShieldAlert size={15} />
      {t('ghost.rejected')}
      <span className="underline underline-offset-2">{t('ghost.why')}</span>
    </button>
  );
}
