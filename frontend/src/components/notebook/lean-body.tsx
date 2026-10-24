'use client';

import { theoremOf, type Line, type LineLean, type Notebook } from '@mn/contracts';
import clsx from 'clsx';
import { Lightbulb, RotateCcw, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { useEngine } from './engine-context';

export function LeanCode({ code }: { code: string }) {
  return <pre className="max-h-60 overflow-auto rounded-xl bg-paper p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap text-ink">{code}</pre>;
}

/** Which explanation a verdict gets (sheet.lean.* keys). */
function summaryKey(lean: LineLean): string {
  if (lean.step === 'ok') return lean.after_failure ? 'afterFailure' : lean.proof === 'proved' ? 'proved' : 'step';
  if (lean.step === 'empty') return 'empty';
  if (lean.step === 'failed') return 'failed';
  if (lean.step === 'unchecked') return 'unchecked';
  return lean.proof === 'unavailable' ? 'unavailable' : lean.proof === 'timeout' ? 'timeout' : 'invalid';
}

const SUMMARY_CLASS: Record<string, string> = {
  proved: 'bg-ok-soft text-ok',
  step: 'bg-ok-soft text-ok',
  afterFailure: 'bg-ok-soft text-ok',
  empty: 'bg-none-soft text-none',
};

function Heading({ children }: { children: ReactNode }) {
  return <h4 className="text-sm font-semibold tracking-wide text-muted uppercase">{children}</h4>;
}

/** Lean's side of a proof line (ADR 0007): the theorem, this line's Lean step, and what Lean said. */
export function LeanBody({ line, nb, lean }: { line: Line; nb: Notebook; lean: LineLean }) {
  const t = useT();
  const engine = useEngine();
  const checking = useNotebook((s) => !!s.leanPending[line.id]);
  const [shown, setShown] = useState({ hint: false, lean: false });
  const key = summaryKey(lean);
  const theorem = lean.scope === 'line' ? lean.statement : (theoremOf(nb)?.statement ?? lean.statement);
  const stuck = lean.step === 'failed' || lean.step === 'unchecked';
  const leanSays = [lean.message, lean.goals && `${t('sheet.leanGoals')}\n${lean.goals}`].filter(Boolean).join('\n\n');
  return (
    <div className="space-y-4 text-base">
      <p className={clsx('rounded-2xl p-4', SUMMARY_CLASS[key] ?? 'bg-unknown-soft text-unknown')}>{t(`sheet.lean.${key}`)}</p>
      {theorem && (
        <section className="space-y-2">
          <Heading>{t(lean.scope === 'line' ? 'sheet.leanClaim' : 'sheet.leanTheorem')}</Heading>
          <LeanCode code={theorem} />
        </section>
      )}
      <section className="space-y-2">
        <Heading>{t('sheet.leanStep')}</Heading>
        {lean.tactic ? <LeanCode code={lean.tactic} /> : <p className="text-muted">{t('sheet.leanNoTactic')}</p>}
      </section>
      {stuck && (
        <div className="flex flex-wrap gap-2">
          {lean.hint && (
            <Button variant={shown.hint ? 'secondary' : 'accent-soft'} icon={<Lightbulb size={17} />} onClick={() => setShown((s) => ({ ...s, hint: true }))}>
              {t('sheet.hint1')}
            </Button>
          )}
          {leanSays && (
            <Button variant={shown.lean ? 'secondary' : 'accent-soft'} icon={<Search size={17} />} onClick={() => setShown((s) => ({ ...s, lean: true }))}>
              {t('sheet.leanShowWhy')}
            </Button>
          )}
        </div>
      )}
      {stuck && shown.hint && lean.hint && <p className="animate-rise rounded-2xl bg-accent-soft/60 p-4 text-base text-ink">{lean.hint}</p>}
      {stuck && shown.lean && leanSays && (
        <section className="animate-rise space-y-2">
          <Heading>{t('sheet.leanSays')}</Heading>
          <LeanCode code={leanSays} />
        </section>
      )}
      {!stuck && lean.proof === 'incomplete' && lean.goals && (
        <section className="space-y-2">
          <Heading>{t('sheet.leanRemaining')}</Heading>
          <LeanCode code={lean.goals} />
        </section>
      )}
      {!stuck && (lean.proof === 'invalid' || lean.proof === 'unavailable') && lean.message && <LeanCode code={lean.message} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={<RotateCcw size={17} />} disabled={checking} onClick={() => void engine.recheckLean(line.id)}>
          {t(checking ? 'line.leanChecking' : 'sheet.leanRecheck')}
        </Button>
        {lean.versions && <span className="text-sm text-muted">{t('sheet.leanVersions', { toolchain: lean.versions.toolchain, mathlib: lean.versions.mathlib })}</span>}
      </div>
    </div>
  );
}

/** On a given line of a proof notebook: the theorem Lean checks the proof against. */
export function LeanTheoremNote({ nb }: { nb: Notebook }) {
  const t = useT();
  const theorem = theoremOf(nb);
  if (!theorem) return null;
  return (
    <section className="space-y-2">
      <Heading>{t('sheet.leanTheorem')}</Heading>
      <LeanCode code={theorem.statement} />
      <p className="text-sm text-muted">{t(theorem.source === 'template' ? 'sheet.leanTheoremTemplate' : 'sheet.leanTheoremAi')}</p>
    </section>
  );
}
