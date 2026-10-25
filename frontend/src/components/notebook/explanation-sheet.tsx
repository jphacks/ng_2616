'use client';

import { leanOf, type Evidence, type Line, type Notebook, type Proof } from '@mn/contracts';
import clsx from 'clsx';
import { CornerUpLeft, Flag, Lightbulb, Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { FEATURES } from '@/features/registry.generated';
import { findLine, isGiven, lineNumber } from '@/core/notebook/model';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Tex } from '@/ui/tex';
import { useEngine } from './engine-context';
import { Segments } from './segments';
import { LeanBody, LeanTheoremNote } from './lean-body';
import { StatusBadge } from './status';

const RELATION_GOALS = new Set(['SOLUTION_CHECK', 'EQUATION_EQUIVALENCE']);

function EvidenceCard({ ev, goal }: { ev: Evidence; goal?: string }) {
  const t = useT();
  const sides = goal && RELATION_GOALS.has(goal);
  return (
    <div className="space-y-2 rounded-2xl bg-paper p-4 text-base">
      {ev.assignment && Object.keys(ev.assignment).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-muted">{t('sheet.at')}</span>
          {Object.entries(ev.assignment).map(([k, v]) => (
            <span key={k} className="rounded-lg bg-sheet px-2 py-0.5 shadow-card">
              <Tex latex={`${k} = ${v}`} />
            </span>
          ))}
        </div>
      )}
      {ev.context_value !== undefined && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1">
          <span className="text-muted">{t(sides ? 'sheet.left' : 'sheet.expected')}</span>
          <Tex latex={ev.context_value} />
          <span className="text-muted">{t(sides ? 'sheet.right' : 'sheet.thisLine')}</span>
          <span className="font-semibold text-wrong-strong">
            <Tex latex={ev.written_value ?? ''} />
          </span>
        </div>
      )}
      {!!ev.missing?.length && (
        <div>
          <span className="text-muted">{t('sheet.missing')}: </span>
          <Tex latex={ev.missing.join(',\\; ')} />
        </div>
      )}
      {!!ev.extra?.length && (
        <div>
          <span className="text-muted">{t('sheet.extra')}: </span>
          <Tex latex={ev.extra.join(',\\; ')} />
        </div>
      )}
      {ev.condition_latex && (
        <div>
          <span className="text-muted">{t('sheet.condition')}: </span>
          <Tex latex={ev.condition_latex} />
        </div>
      )}
      {ev.approx && <div className="text-sm text-muted">({t('sheet.approx')})</div>}
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
  return (
    <div className="space-y-4">
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
  // a proof line Lean checked shows Lean's verdict, not the CAS's "cannot read this" (ADR 0008)
  const lean = leanOf(line);
  const leanChecked = lean?.proof ? lean : undefined;
  const title = leanChecked
    ? t('sheet.leanTitle', { n })
    : proof.status === 'wrong'
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
      title={<span className={clsx(!leanChecked && proof.status === 'wrong' && 'text-wrong-strong')}>{title}</span>}
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
          <div className="flex items-center justify-between pt-1">
            <StatusBadge line={line} ancestor={proof.unverified_ancestors[0] ? lineNumber(nb, proof.unverified_ancestors[0]) : null} />
            <div className="flex items-center gap-2">
              {FEATURES.flatMap((f) => f.lineActions ?? []).map((Action, i) => (
                <Action key={i} line={line} />
              ))}
            </div>
          </div>
        </div>
        {leanChecked ? (
          <LeanBody line={line} nb={nb} lean={leanChecked} />
        ) : proof.status === 'wrong' ? (
          <WrongBody line={line} nb={nb} proof={proof} />
        ) : (
          <DetailBody line={line} nb={nb} proof={proof} />
        )}
        {isGiven(line) && <LeanTheoremNote nb={nb} />}
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
