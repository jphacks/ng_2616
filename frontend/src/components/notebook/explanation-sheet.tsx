'use client';

import type { Evidence, Line, Notebook, Proof } from '@mn/contracts';
import clsx from 'clsx';
import { CornerUpLeft, Flag, Lightbulb, Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { findLine, isGiven, lineNumber } from '@/core/notebook/model';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Tex } from '@/ui/tex';
import { useEngine } from './engine-context';
import { Segments } from './segments';
import { StatusBadge } from './status';

const RELATION_GOALS = new Set(['SOLUTION_CHECK', 'EQUATION_EQUIVALENCE']);

function EvidenceCard({ ev, goal }: { ev: Evidence; goal?: string }) {
  const t = useT();
  const sides = goal && RELATION_GOALS.has(goal);
  return (
    <div className="space-y-3 rounded-2xl bg-paper p-4 text-base shadow-sm border border-border/40">
      {ev.assignment && Object.keys(ev.assignment).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('sheet.at')}</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ev.assignment).map(([k, v]) => (
              <span key={k} className="rounded-lg bg-sheet px-2 py-0.5 text-sm font-medium shadow-card border border-border/40">
                <Tex latex={`${k} = ${v}`} />
              </span>
            ))}
          </div>
        </div>
      )}
      {ev.context_value !== undefined && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div className="rounded-xl bg-sheet/80 p-3 border border-border/50">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
              {t(sides ? 'sheet.left' : 'sheet.expected')}
            </div>
            <div className="text-base font-medium text-ink">
              <Tex latex={ev.context_value} />
            </div>
          </div>
          <div className="rounded-xl bg-wrong-soft/60 p-3 border border-wrong/30">
            <div className="text-xs font-semibold uppercase tracking-wider text-wrong-strong mb-1">
              {t(sides ? 'sheet.right' : 'sheet.thisLine')}
            </div>
            <div className="text-base font-bold text-wrong-strong">
              <Tex latex={ev.written_value ?? ''} />
            </div>
          </div>
        </div>
      )}
      {!!ev.missing?.length && (
        <div className="rounded-xl bg-sheet/60 p-2.5 text-sm border border-border/40">
          <span className="font-semibold text-muted">{t('sheet.missing')}: </span>
          <Tex latex={ev.missing.join(',\\; ')} />
        </div>
      )}
      {!!ev.extra?.length && (
        <div className="rounded-xl bg-sheet/60 p-2.5 text-sm border border-border/40">
          <span className="font-semibold text-muted">{t('sheet.extra')}: </span>
          <Tex latex={ev.extra.join(',\\; ')} />
        </div>
      )}
      {ev.condition_latex && (
        <div className="text-sm">
          <span className="text-muted">{t('sheet.condition')}: </span>
          <Tex latex={ev.condition_latex} />
        </div>
      )}
      {ev.approx && <div className="text-xs text-muted">({t('sheet.approx')})</div>}
    </div>
  );
}

function hintText(t: ReturnType<typeof useT>, nb: Notebook, h: Proof['hints'][number]): string {
  const ref = h.refs[0];
  const n = ref ? lineNumber(nb, ref) : null;
  return h.template_id ? t(`hint.${h.template_id}`, { line: n ?? '?' }) : h.text;
}

function WrongBody({ line, nb, proof }: { line: Line; nb: Notebook; proof: Proof }) {
  const t = useT();
  const engine = useEngine();
  const [shown, setShown] = useState<{ evidence: boolean; hint1: boolean; hint2: boolean }>({ evidence: false, hint1: false, hint2: false });
  const root = line.recovery_root_id ?? line.id;
  const open = (k: 'evidence' | 'hint1' | 'hint2') => {
    setShown((s) => ({ ...s, [k]: true }));
    engine.markRecovery(root, k);
  };
  const h1 = proof.hints.find((h) => h.level === 1);
  const h2 = proof.hints.find((h) => h.level === 2);

  const steps = [
    { label: t('sheet.stepCategory'), done: true },
    { label: t('sheet.stepEvidence'), done: shown.evidence },
    { label: t('sheet.stepHint1'), done: shown.hint1 },
    { label: t('sheet.stepHint2'), done: shown.hint2 },
    { label: t('sheet.stepRevise'), done: false },
  ];

  return (
    <div className="space-y-4">
      {/* 5-step recovery progress indicator (spec v1.6 §7.6) */}
      <div className="rounded-2xl bg-sheet/60 p-3 border border-border/50">
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted mb-2">{t('sheet.recoverySteps')}</div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {steps.map((st, i) => (
            <div key={i} className="flex items-center gap-1.5 shrink-0">
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                  st.done
                    ? 'bg-ok-soft text-ok font-semibold'
                    : 'bg-muted/15 text-muted'
                )}
              >
                <span>{i + 1}.</span>
                <span>{st.label}</span>
              </span>
              {i < steps.length - 1 && <span className="text-muted/40 text-xs select-none">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={shown.evidence ? 'secondary' : 'accent-soft'} icon={<Search size={17} />} onClick={() => open('evidence')}>
          {t('sheet.showEvidence')}
        </Button>
        <Button variant={shown.hint1 ? 'secondary' : 'accent-soft'} icon={<Lightbulb size={17} />} onClick={() => open('hint1')}>
          {t('sheet.hint1')}
        </Button>
        <Button variant={shown.hint2 ? 'secondary' : 'accent-soft'} icon={<Lightbulb size={17} />} onClick={() => open('hint2')} disabled={!shown.hint1}>
          {t('sheet.hint2')}
        </Button>
      </div>
      {shown.evidence && (
        <section className="animate-rise space-y-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('sheet.evidence')}</h4>
          {proof.evidence.map((ev, i) => (
            <EvidenceCard key={i} ev={ev} goal={proof.goal} />
          ))}
        </section>
      )}
      {shown.hint1 && h1 && <p className="animate-rise rounded-2xl bg-accent-soft/60 p-4 text-base text-ink">{hintText(t, nb, h1)}</p>}
      {shown.hint2 && h2 && <p className="animate-rise rounded-2xl bg-accent-soft/60 p-4 text-base text-ink">{hintText(t, nb, h2)}</p>}
    </div>
  );
}

function DetailBody({ line: _line, nb, proof }: { line: Line; nb: Notebook; proof: Proof }) {
  const t = useT();
  const src = proof.segment_results.find((r) => r.source_line_id)?.source_line_id;
  const srcN = src ? lineNumber(nb, src) : null;
  return (
    <div className="space-y-3 text-base">
      {proof.status === 'ok' && proof.unverified_ancestors.length > 0 && (
        <p className="rounded-2xl bg-unknown-soft p-4 text-unknown">
          {t('sheet.localBody', { lines: proof.unverified_ancestors.map((id) => lineNumber(nb, id) ?? '?').join(', ') })}
        </p>
      )}
      {proof.status === 'unknown' && proof.reason && <p className="rounded-2xl bg-unknown-soft p-4 text-unknown">{t(`reason.${proof.reason}`)}</p>}
      {proof.status === 'none' && proof.reason && <p className="rounded-2xl bg-none-soft p-4 text-none">{t(`none.${proof.reason}`)}</p>}
      {proof.method && (
        <p>
          <span className="text-muted">{t('sheet.method')}: </span>
          {t(`method.${proof.method}`)}
        </p>
      )}
      {srcN !== null && <p className="text-muted">{t('sheet.comparedWith', { n: srcN })}</p>}
      {proof.conditions.length > 0 && (
        <div>
          <span className="text-muted">{t('sheet.conditions')}: </span>
          <span className="inline-flex flex-wrap gap-x-3">
            {proof.conditions.map((c, i) => (/[\\^_]/.test(c) ? <Tex key={i} latex={c} /> : <span key={i}>{c}</span>))}
          </span>
        </div>
      )}
      {proof.evidence.length > 0 && proof.status !== 'wrong' && proof.evidence.map((ev, i) => <EvidenceCard key={i} ev={ev} goal={proof.goal} />)}
    </div>
  );
}

export function ExplanationSheet() {
  const t = useT();
  const engine = useEngine();
  const sheet = useNotebook((s) => s.sheet);
  const nb = useNotebook((s) => s.notebook);
  const rejection = useNotebook((s) => s.rejection);
  const close = () => useNotebook.getState().set('sheet', null);
  if (!sheet || !nb) return null;

  if (sheet.kind === 'rejection') {
    if (!rejection) return null;
    const p = rejection.proof;
    return (
      <Sheet open onClose={close} title={<span className="inline-flex items-center gap-2"><ShieldAlert size={20} className="text-wrong-strong" />{t('sheet.rejectionTitle')}</span>}>
        <div className="space-y-4">
          <p className="text-base text-ink-soft">{t('sheet.rejectionBody')}</p>
          <div className="rounded-2xl border border-dashed border-wrong/40 bg-wrong-soft/50 p-4">
            <Segments segments={rejection.segments} />
          </div>
          <p className="font-medium text-wrong-strong">{t(`cat.${p.category ?? 'UNCLASSIFIED'}`)}</p>
          {p.evidence.map((ev, i) => (
            <EvidenceCard key={i} ev={ev} goal={p.goal} />
          ))}
        </div>
      </Sheet>
    );
  }

  const line = findLine(nb, sheet.lineId);
  const proof = line?.verified?.proof;
  if (!line || !proof) return null;
  const n = lineNumber(nb, line.id) ?? 0;
  const title =
    proof.status === 'wrong'
      ? t('sheet.wrongTitle', { category: t(`cat.${proof.category ?? 'UNCLASSIFIED'}`), n })
      : proof.status === 'ok'
        ? t(proof.unverified_ancestors.length ? 'sheet.localTitle' : 'sheet.okTitle', { n })
        : proof.status === 'unknown'
          ? t('sheet.unknownTitle', { n })
          : t('sheet.noneTitle', { n });
  return (
    <Sheet
      open
      onClose={close}
      title={<span className={clsx(proof.status === 'wrong' && 'text-wrong-strong')}>{title}</span>}
      footer={
        proof.status === 'wrong' && line.state === 'SETTLED' ? (
          <Button variant="primary" icon={<CornerUpLeft size={18} />} className="w-full" onClick={() => engine.startRevision(line.id)}>
            {t('sheet.revise')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="space-y-2 rounded-2xl bg-paper p-4">
          <Segments segments={line.segments} />
          <StatusBadge line={line} ancestor={proof.unverified_ancestors[0] ? lineNumber(nb, proof.unverified_ancestors[0]) : null} />
        </div>
        {proof.status === 'wrong' ? <WrongBody line={line} nb={nb} proof={proof} /> : <DetailBody line={line} nb={nb} proof={proof} />}
        {line.state === 'SETTLED' && (
          <div className="space-y-2 border-t border-border pt-4">
            <Button
              variant={isGiven(line) ? 'secondary' : 'accent-soft'}
              icon={<Flag size={17} />}
              aria-pressed={isGiven(line)}
              onClick={() => engine.setGiven(line.id, !isGiven(line))}
            >
              {t(isGiven(line) ? 'sheet.unmarkGiven' : 'sheet.markGiven')}
            </Button>
            <p className="text-sm text-muted">{t('sheet.givenHint')}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
