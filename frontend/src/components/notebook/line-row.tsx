'use client';

import type { Line } from '@mn/contracts';
import clsx from 'clsx';
import { Check, CornerUpLeft, Info, PenLine, RotateCcw, Sparkles, StickyNote, Trash2, TriangleAlert } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { FEATURES } from '@/features/registry.generated';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button, IconButton } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { useEngine } from './engine-context';
import { isPenDown } from './gestures';
import { GhostLine, RejectionChip } from './ghost-line';
import { InkCanvas } from './ink-canvas';
import { Segments } from './segments';
import { StatusBadge } from './status';
import { SwipeRow, type SwipeAction } from './swipe-row';

interface RowProps {
  line: Line;
  number: number;
  isLastDraft: boolean;
  /** number of the line this one revises */
  revisionOf: number | null;
  /** number of the first unverified line this one depends on */
  ancestor: number | null;
  ghostWithoutTarget: boolean;
}

function useSlowFeedback(active: boolean, delayMs = 8000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setSlow(true), delayMs);
    return () => {
      window.clearTimeout(timer);
      setSlow(false);
    };
  }, [active, delayMs]);
  return active && slow;
}

export const LineRow = memo(function LineRow({ line, number, isLastDraft, revisionOf, ancestor, ghostWithoutTarget }: RowProps) {
  const t = useT();
  const engine = useEngine();
  const tool = useNotebook((s) => s.tool);
  const active = useNotebook((s) => s.activeLineId === line.id);
  const draftCount = useNotebook((s) => s.notebook?.lines.filter((l) => l.state === 'DRAFT').length ?? 0);
  const candidate = useNotebook((s) => s.candidate);
  const rejection = useNotebook((s) => s.rejection);
  const leanChecking = useNotebook((s) => !!s.leanPending[line.id]);

  const slowRecognizing = useSlowFeedback(line.state === 'RECOGNIZING', 8000);
  const slowVerifying = useSlowFeedback(line.state === 'VERIFYING', 8000);

  const ghostHere =
    candidate &&
    ((candidate.mode === 'NEXT_STEP' && candidate.targetLineId === line.id && line.state === 'DRAFT' && line.ink.length === 0) ||
      (candidate.mode === 'COMPLETE_RHS' && candidate.targetLineId === line.id));
  const showGhost = (ghostHere || ghostWithoutTarget) && line.ink.length === 0;
  const showRejection = rejection && line.state === 'DRAFT' && isLastDraft;
  const pdfQuestion = line.extensions?.pdf_question as { label?: string; title?: string; mock?: boolean; corrected?: boolean } | undefined;
  const openDetails = () => engine.openLine(line.id);

  if (line.state === 'SUPERSEDED') {
    return (
      <div className="ruled flex min-h-14 items-center gap-3 pr-4 opacity-60 hover:opacity-90 transition-opacity">
        <Gutter n={number} line={line} />
        <button type="button" onClick={openDetails} className="min-w-0 flex-1 text-left line-through decoration-wrong/50">
          <Segments segments={line.segments} />
        </button>
        <button
          type="button"
          onClick={openDetails}
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-none-soft px-2.5 py-1 text-xs font-medium text-muted hover:text-ink transition-colors"
          title={t('line.superseded')}
        >
          <CornerUpLeft size={13} />
          <span>{t('line.superseded')}</span>
        </button>
      </div>
    );
  }

  // swiping a settled or failed line left reveals its actions, as in Mail
  const swipe: SwipeAction[] =
    line.state === 'SETTLED'
      ? [
          ...(line.is_memo
            ? [
                { label: t('line.memoToMath'), icon: <PenLine size={18} />, onClick: () => void engine.toggleMemo(line.id), tone: 'accent' as const },
                ...(line.ink.length > 0 ? [{ label: t('line.backToInk'), icon: <PenLine size={18} />, onClick: () => engine.backToInk(line.id) }] : []),
              ]
            : [
                { label: t('line.mathToMemo'), icon: <StickyNote size={18} />, onClick: () => void engine.toggleMemo(line.id) },
                ...(line.verified?.proof.status === 'wrong'
                  ? [{ label: t('line.revise'), icon: <CornerUpLeft size={18} />, onClick: () => engine.startRevision(line.id), tone: 'warn' as const }]
                  : []),
                { label: t('line.details'), icon: <Info size={18} />, onClick: openDetails, tone: 'accent' as const },
              ]),
        ]
      : line.state === 'RECOGNIZE_FAILED'
        ? [
            { label: t('line.mathToMemo'), icon: <StickyNote size={18} />, onClick: () => void engine.toggleMemo(line.id) },
            ...(line.ink.length > 0 ? [{ label: t('line.backToInk'), icon: <PenLine size={18} />, onClick: () => engine.backToInk(line.id) }] : []),
            { label: t('line.retry'), icon: <RotateCcw size={18} />, onClick: () => void engine.retry(line.id), tone: 'accent' as const },
          ]
        : [];

  return (
    <SwipeRow
      id={line.id}
      actions={swipe}
      className={clsx(
        'ruled relative flex gap-3 pr-4 transition-colors',
        active && line.state === 'DRAFT' && (line.is_memo ? 'bg-amber-500/10' : 'bg-accent-soft/25'),
        line.is_memo && line.state === 'SETTLED' && 'bg-amber-500/[0.04]',
      )}
      onClick={() => {
        if (isPenDown()) return;
        if (line.state === 'DRAFT' && !active) {
          engine.activate(line.id);
        } else if (line.state === 'SETTLED' && line.is_memo) {
          engine.backToInk(line.id);
        }
      }}
    >
      <Gutter n={number} line={line} />
      {/* centered, so the line stays level with the gutter when the status column is the taller one */}
      <div className="min-w-0 flex-1 self-center py-2">
        {line.document_origin && <p className="mb-1 break-all text-xs text-muted">
          {line.document_origin.name} · p.{line.document_origin.page}
          {pdfQuestion?.label && <> · {t('question.number', { n: pdfQuestion.label })}</>}
          {pdfQuestion?.title && <> · {pdfQuestion.title}</>}
          {pdfQuestion?.mock && <> · {t('question.mock')}</>}
          {pdfQuestion?.corrected && <> · {t('question.corrected')}</>}
          {line.document_origin.has_unreadable && <> · {t('question.unreadable')}</>}
        </p>}
        {revisionOf !== null && (
          <div className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-unknown">
            <CornerUpLeft size={14} /> {t('line.revising', { n: revisionOf })}
          </div>
        )}
        {line.state === 'DRAFT' && showRejection && <RejectionChip />}
        {line.state === 'DRAFT' && (
          <div className="relative">
            {showGhost && candidate ? (
              <div className="absolute inset-x-0 top-1 z-raised">
                <GhostLine candidate={candidate} />
              </div>
            ) : (
              active &&
              line.ink.length === 0 &&
              tool === 'pen' && (
                <div className="pointer-events-none absolute left-2 top-12 text-base text-faint">
                  {t(line.is_memo ? 'line.memoWriteHere' : 'line.writeHere')}
                </div>
              )
            )}
            <InkCanvas
              strokes={line.ink}
              editable={active}
              tool={tool}
              onActivate={() => !active && engine.activate(line.id)}
              onPenDown={() => !active && engine.activate(line.id)}
              onStroke={(s) => engine.addStroke(line.id, s)}
              onErase={(ids) => engine.eraseStrokes(line.id, ids)}
              onScratchOut={(ids) => {
                engine.eraseStrokes(line.id, ids);
                useNotebook.getState().showToast(t('toast.erased'), 'info', { label: t('tool.undo'), run: () => engine.undo() });
              }}
            />
          </div>
        )}
        {line.state === 'RECOGNIZING' && (
          <div className="relative">
            <InkCanvas strokes={line.ink} editable={false} tool={tool} dim />
            <div className="shimmer absolute inset-0 flex items-end rounded-xl p-2 text-sm text-accent">
              <span className="inline-flex items-center gap-2 rounded-full bg-sheet/90 px-3 py-1 shadow-card">
                <Spinner size={14} /> {t(slowRecognizing ? 'line.readingSlow' : 'line.reading')}
              </span>
            </div>
          </div>
        )}
        {line.state === 'RECOGNIZE_FAILED' && (
          <div>
            {line.ink.length > 0 ? <InkCanvas strokes={line.ink} editable={false} tool={tool} dim /> : <Segments segments={line.segments} />}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-md text-danger">
              <TriangleAlert size={16} />
              <span>
                {t(line.failure?.stage === 'verify' ? 'line.verifyFailed' : 'line.failed')}
                {line.failure?.code ? ` (${line.failure.code})` : ''}
              </span>
              {line.failure?.message && <span className="max-w-full truncate text-muted">{line.failure.message}</span>}
            </div>
          </div>
        )}
        {line.state === 'SETTLED' && line.is_memo && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => engine.backToInk(line.id)}
            onKeyDown={(e) => e.key === 'Enter' && engine.backToInk(line.id)}
            className="flex min-h-16 w-full min-w-0 cursor-text items-center text-left"
            title={t('line.backToInk')}
          >
            <InkCanvas strokes={line.ink} editable={false} tool={tool} />
          </div>
        )}
        {line.state === 'SETTLED' && !line.is_memo && (
          <button type="button" onClick={openDetails} className="flex min-h-16 w-full min-w-0 items-center text-left">
            <Segments segments={line.segments} className="w-full" />
          </button>
        )}
        {line.state === 'VERIFYING' && (
          <button type="button" onClick={openDetails} className="flex min-h-16 w-full min-w-0 items-center text-left">
            <Segments segments={line.segments} className="w-full" />
          </button>
        )}
        {line.state === 'SETTLED' && ghostHere && candidate?.mode === 'COMPLETE_RHS' && (
          <div className="mt-2">
            <GhostLine candidate={candidate} />
          </div>
        )}
      </div>
      <div className="flex w-[11.5rem] shrink-0 flex-col items-end justify-center gap-2 py-2">
        {line.state === 'DRAFT' && active && (
          <div className="flex items-center gap-1">
            <IconButton
              label={t(line.is_memo ? 'line.memoActive' : 'line.memoToggle')}
              active={line.is_memo}
              className={clsx(line.is_memo && '!text-amber-600 !bg-amber-500/15 hover:!bg-amber-500/25')}
              onClick={() => void engine.toggleMemo(line.id)}
            >
              <StickyNote size={19} />
            </IconButton>
            <IconButton
              label={line.ink.length > 0 ? t('tool.clear') : t('tool.deleteDraft')}
              onClick={() => {
                if (line.ink.length > 0) {
                  engine.clearDraft(line.id);
                  useNotebook.getState().showToast(t('toast.cleared'), 'info', { label: t('tool.undo'), run: () => engine.undo() });
                } else if (draftCount > 1) {
                  engine.deleteDraft(line.id);
                  useNotebook.getState().showToast(t('toast.draftDeleted'), 'info');
                }
              }}
              disabled={line.ink.length === 0 && draftCount <= 1}
            >
              <Trash2 size={19} />
            </IconButton>
            <Button variant="primary" icon={<Check size={18} />} disabled={line.ink.length === 0} onClick={() => void engine.confirmLine(line.id)}>
              {t('line.confirm')}
            </Button>
          </div>
        )}
        {line.state === 'RECOGNIZE_FAILED' && (
          <div className="flex flex-col items-end gap-1.5">
            <Button size="sm" icon={<RotateCcw size={15} />} onClick={() => void engine.retry(line.id)}>
              {t('line.retry')}
            </Button>
            {line.ink.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => engine.backToInk(line.id)}>
                {t('line.backToInk')}
              </Button>
            )}
          </div>
        )}
        {line.state === 'VERIFYING' && (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Spinner size={14} /> {t(slowVerifying ? 'line.checkingSlow' : 'line.checking')}
          </span>
        )}
        {/* the verdict first, then what can be done with the line, then the Lean check in progress */}
        {line.state === 'SETTLED' && line.is_memo && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void engine.toggleMemo(line.id)}
              title={t('line.memoToMath')}
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-colors"
            >
              <StickyNote size={13} />
              <span>{t('line.memoBadge')}</span>
            </button>
            <Button size="sm" variant="ghost" onClick={() => void engine.toggleMemo(line.id)}>
              {t('line.memoToMathShort')}
            </Button>
          </div>
        )}
        {line.state === 'SETTLED' && !line.is_memo && <StatusBadge line={line} ancestor={ancestor} onClick={openDetails} />}
        {line.state === 'SETTLED' && !line.is_memo && line.verified?.proof.status === 'wrong' && (
          <Button size="sm" variant="ghost" icon={<CornerUpLeft size={15} />} onClick={() => engine.startRevision(line.id)}>
            {t('line.revise')}
          </Button>
        )}
        {line.state === 'SETTLED' && !line.is_memo &&
          FEATURES.flatMap((f) => f.lineActions ?? []).map((Action, i) => <Action key={i} line={line} />)}
        {line.state === 'SETTLED' && !line.is_memo && leanChecking && (
          <span className="inline-flex items-center gap-2 text-sm text-muted" data-lean="checking">
            <Spinner size={14} /> {t('line.leanChecking')}
          </span>
        )}
      </div>
    </SwipeRow>
  );
});

function Gutter({ n, line }: { n: number; line: Line }) {
  const t = useT();
  return (
    <div className="flex w-10 shrink-0 flex-col items-end gap-1 self-center text-right text-2xs font-medium tabular-nums text-faint">
      <span>{n}</span>
      {line.is_memo && (
        <span className="rounded-md bg-amber-500/15 px-1 text-2xs font-medium text-amber-700 dark:text-amber-300">{t('line.memo')}</span>
      )}
      {line.role === 'premise' && (
        <span className="rounded-md px-1 text-2xs font-medium text-none">{t('line.given')}</span>
      )}
      {line.source === 'ai' && (
        <span className={clsx('inline-flex items-center gap-0.5 rounded-md px-1 text-2xs font-medium', line.ai_origin?.unverified_adoption ? 'text-unknown' : 'text-accent')} title={line.ai_origin?.unverified_adoption ? t('line.unverifiedAdoption') : undefined}>
          <Sparkles size={11} />
          {t('line.ai')}
        </span>
      )}
    </div>
  );
}
