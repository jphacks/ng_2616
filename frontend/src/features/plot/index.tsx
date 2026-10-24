'use client';

import type { Line } from '@mn/contracts';
import { LineChart } from 'lucide-react';
import { useState } from 'react';
import type { FeaturePlugin } from '@/features/types';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { analyzeLineForPlot } from './evaluator';
import { PlotSheet } from './plot-sheet';

export function PlotLineAction({ line }: { line: Line }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Only show for settled lines with math
  if (line.state !== 'SETTLED') return null;

  const analysis = analyzeLineForPlot(line);
  // Don't show button if there is no math formula
  if (!analysis.targetExpr && !analysis.drawable) return null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<LineChart size={15} />}
        onClick={() => setOpen(true)}
        className="text-xs text-accent hover:bg-accent-soft/40"
      >
        {t('plot.action') || 'グラフ'}
      </Button>

      {open && <PlotSheet line={line} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

const plotPlugin: FeaturePlugin = {
  id: 'plot',
  lineActions: [PlotLineAction],
};

export default plotPlugin;
export * from './evaluator';
export * from './plot-sheet';
export * from './types';
