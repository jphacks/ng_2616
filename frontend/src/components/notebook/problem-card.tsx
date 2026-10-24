'use client';

import type { Assumption, Problem } from '@mn/contracts';
import { printLatex, symbolToLatex } from '@mn/contracts/ir';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';
import { useT } from '@/i18n';
import { Tex } from '@/ui/tex';
import { InlineSegments } from './segments';

function assumptionLatex(a: Assumption): string {
  const s = symbolToLatex(a.symbol);
  switch (a.kind) {
    case 'positive':
      return `${s} > 0`;
    case 'nonnegative':
      return `${s} \\ge 0`;
    case 'nonzero':
      return `${a.expr !== undefined ? printLatex(a.expr) : s} \\neq 0`;
    case 'positive_integer':
      return `${s} \\in \\mathbb{Z}^{+}`;
    case 'interval':
      return `${a.lower !== undefined ? printLatex(a.lower) : '-\\infty'} \\le ${s} \\le ${a.upper !== undefined ? printLatex(a.upper) : '\\infty'}`;
    case 'real':
      return `${s} \\in \\mathbb{R}`;
  }
}

export const ProblemCard = memo(function ProblemCard({ problem }: { problem: Problem }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const fns = problem.functions ?? [];
  return (
    <section aria-label={t('question.card')} className="mx-4 mt-4 mb-2 rounded-2xl bg-sheet shadow-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full min-h-12 items-center gap-3 px-5 py-3 text-left">
        <span className="flex-1 truncate text-[17px] font-semibold">{problem.title}</span>
        <ChevronDown size={18} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 px-5 pb-5">
          {problem.statement.length > 0 && <InlineSegments segments={problem.statement} className="text-[16px] [&_.katex]:text-[1.1em]" />}
          <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[auto_1fr]">
            {problem.origin?.kind === 'pdf' && (
              <Row label={t('question.source')}>
                <span>{problem.origin.name} · p.{problem.origin.page} · {t('question.number', { n: problem.origin.question_label ?? '' })}</span>
                {problem.origin.mock && <span>{t('question.mock')}</span>}
                {problem.origin.corrected && <span>{t('question.corrected')}</span>}
              </Row>
            )}
            {problem.independent_var && <Row label={t('question.independentVar')}><Tex latex={symbolToLatex(problem.independent_var)} /></Row>}
            {problem.conditions.length > 0 && (
              <Row label={t('problem.given')}>
                {problem.conditions.map((c, i) => (
                  <Tex key={i} latex={printLatex(c)} />
                ))}
              </Row>
            )}
            {problem.definitions.length > 0 && (
              <Row label={t('problem.definitions')}>
                {problem.definitions.map((d, i) => (
                  <Tex key={i} latex={printLatex(d)} />
                ))}
              </Row>
            )}
            {problem.assumptions.length > 0 && (
              <Row label={t('problem.assumptions')}>
                {problem.assumptions.map((a, i) => (
                  <span key={i} className="rounded-lg bg-none-soft px-2 py-0.5">
                    <Tex latex={assumptionLatex(a)} />
                  </span>
                ))}
              </Row>
            )}
            {fns.length > 0 && (
              <Row label={t('problem.functions')}>
                {fns.map((f) => (
                  <Tex key={f.name} latex={`${symbolToLatex(f.name)}(${f.args.map(symbolToLatex).join(', ')})`} />
                ))}
              </Row>
            )}
            {problem.unknowns.length > 0 && (
              <Row label={t('problem.unknowns')}>
                <Tex latex={problem.unknowns.map(symbolToLatex).join(', ')} />
              </Row>
            )}
            {problem.origin?.kind === 'pdf' && problem.assumptions.length === 0 && problem.conditions.length === 0 && problem.definitions.length === 0 && <Row label={t('question.premises')}><span>{t('question.noPremises')}</span></Row>}
          </dl>
          {problem.origin?.kind === 'pdf' && <p className="text-[12px] text-muted">{t('question.domain')}</p>}
        </div>
      )}
    </section>
  );
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-1 font-medium text-muted">{label}</dt>
      <dd className="flex flex-wrap items-center gap-x-4 gap-y-1">{children}</dd>
    </>
  );
}
