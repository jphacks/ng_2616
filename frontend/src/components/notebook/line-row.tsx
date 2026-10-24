'use client';

import type { Line } from '@mn/contracts';
import clsx from 'clsx';
import { Check, CornerUpLeft, Info, PenLine, RotateCcw, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button, IconButton } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { useEngine } from './engine-context';
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

export const LineRow = memo(function LineRow({ line, number, isLastDraft, revisionOf, ancestor, ghostWithoutTarget }: RowProps) {
  const t = useT();
  const engine = useEngine();
  const tool = useNotebook((s) => s.tool);
  const active = useNotebook((s) => s.activeLineId === line.id);
  const candidate = useNotebook((s) => s.candidate);
  const rejection = useNotebook((s) => s.rejection);

  const ghostHere =
    candidate &&
    ((candidate.mode === 'NEXT_STEP' && candidate.targetLineId === line.id && line.state === 'DRAFT' && line.ink.length === 0) ||
      (candidate.mode === 'COMPLETE_RHS' && candidate.targetLineId === line.id));
  const showGhost = (ghostHere || ghostWithoutTarget) && line.ink.length === 0;
  const showRejection = rejection && line.state === 'DRAFT' && isLastDraft;
  const openDetails = () => engine.openLine(line.id);

  if (line.state === 'SUPERSEDED') {
    return (
      <div className="ruled flex min-h-14 items-center gap-3 pr-4 opacity-55">
        <Gutter n={number} line={line} />
        <div className="min-w-0 flex-1 line-through decoration-wrong/50">
          <Segments segments={line.segments} />
        </div>
        <span className="shrink-0 text-sm text-muted">{t('line.superseded')}</span>
      </div>
    );
  }

  // swiping a settled or failed line left reveals its actions, as in Mail
  const swipe: SwipeAction[] =
    line.state === 'SETTLED'
      ? [
          ...(line.verified?.proof.status === 'wrong'
            ? [{ label: t('line.revise'), icon: <CornerUpLeft size={18} />, onClick: () => engine.startRevision(line.id), tone: 'warn' as const }]
            : []),
          { label: t('line.details'), icon: <Info size={18} />, onClick: openDetails, tone: 'accent' },
        ]
      : line.state === 'RECOGNIZE_FAILED'
        ? [
            ...(line.ink.length > 0 ? [{ label: t('line.backToInk'), icon: <PenLine size={18} />, onClick: () => engine.backToInk(line.id) }] : []),
            { label: t('line.retry'), icon: <RotateCcw size={18} />, onClick: () => void engine.retry(line.id), tone: 'accent' },
          ]
        : [];

  return (
    <SwipeRow
      id={line.id}
      actions={swipe}
      className={clsx('ruled relative flex gap-3 pr-4 transition-colors', active && line.state === 'DRAFT' && 'bg-accent-soft/25')}
    >
      <Gutter n={number} line={line} />
      <div className="min-w-0 flex-1 py-2">
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
              tool === 'pen' && <div className="pointer-events-none absolute left-2 top-12 text-base text-faint">{t('line.writeHere')}</div>
            )}
            <InkCanvas
              strokes={line.ink}
              editable
              tool={tool}
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
                <Spinner size={14} /> {t('line.reading')}
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
        {(line.state === 'SETTLED' || line.state === 'VERIFYING') && (
          <button type="button" onClick={openDetails} className="block w-full min-w-0 text-left">
            <Segments segments={line.segments} className="min-h-16" />
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
              label={t('tool.clear')}
              onClick={() => {
                engine.clearDraft(line.id);
                useNotebook.getState().showToast(t('toast.cleared'), 'info', { label: t('tool.undo'), run: () => engine.undo() });
              }}
              disabled={line.ink.length === 0}
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
            <Spinner size={14} /> {t('line.checking')}
          </span>
        )}
        {line.state === 'SETTLED' && <StatusBadge line={line} ancestor={ancestor} onClick={openDetails} />}
        {line.state === 'SETTLED' && line.verified?.proof.status === 'wrong' && (
          <Button size="sm" variant="ghost" icon={<CornerUpLeft size={15} />} onClick={() => engine.startRevision(line.id)}>
            {t('line.revise')}
          </Button>
        )}
      </div>
    </SwipeRow>
  );
});

function Gutter({ n, line }: { n: number; line: Line }) {
  const t = useT();
  return (
    <div className="flex w-12 shrink-0 flex-col items-end gap-1 pt-4 text-right text-sm tabular-nums text-faint">
      <span>{n}</span>
      {line.source === 'ai' && (
        <span className={clsx('inline-flex items-center gap-0.5 rounded-md px-1 text-2xs font-medium', line.ai_origin?.unverified_adoption ? 'text-unknown' : 'text-accent')} title={line.ai_origin?.unverified_adoption ? t('line.unverifiedAdoption') : undefined}>
          <Sparkles size={11} />
          {t('line.ai')}
        </span>
      )}
    </div>
  );
}
