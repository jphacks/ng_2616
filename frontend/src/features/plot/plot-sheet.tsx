'use client';

import type { Line } from '@mn/contracts';
import clsx from 'clsx';
import { Download, Info, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNotebook } from '@/core/store/notebook-store';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Tex } from '@/ui/tex';
import { ChartCanvas } from './chart-canvas';
import { exportPlotPng } from './chart-renderer';
import { analyzeLineForPlot, generatePlotData } from './evaluator';
import type { PlotSettings } from './types';

interface PlotSheetProps {
  line: Line;
  open: boolean;
  onClose: () => void;
}

const PRESET_RANGES: { label: string; range: [number, number] }[] = [
  { label: '[-10, 10]', range: [-10, 10] },
  { label: '[-5, 5]', range: [-5, 5] },
  { label: '[0, 10]', range: [0, 10] },
  { label: '[-2π, 2π]', range: [-Math.PI * 2, Math.PI * 2] },
];

export function PlotSheet({ line, open, onClose }: PlotSheetProps) {
  const t = useT();
  const patchLine = useNotebook((s) => s.patchLine);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const analysis = useMemo(() => analyzeLineForPlot(line), [line]);

  const savedSettings = (line.extensions?.plot as Partial<PlotSettings>) ?? {};

  const [range, setRange] = useState<[number, number]>(
    savedSettings.range ?? [-10, 10],
  );
  const [params, setParams] = useState<Record<string, number>>(() => ({
    ...analysis.initialParams,
    ...(savedSettings.params ?? {}),
  }));

  const persistSettings = useCallback(
    (newRange: [number, number], newParams: Record<string, number>) => {
      const settings: PlotSettings = {
        x_var: analysis.xVar,
        params: newParams,
        range: newRange,
        points: 400,
        view: 're',
      };
      patchLine(line.id, (l) => ({
        ...l,
        extensions: {
          ...l.extensions,
          plot: settings,
        },
      }));
    },
    [analysis.xVar, line.id, patchLine],
  );

  const handleRangeChange = (newRange: [number, number]) => {
    setRange(newRange);
    persistSettings(newRange, params);
  };

  const handleParamChange = (name: string, value: number) => {
    const updated = { ...params, [name]: value };
    setParams(updated);
    persistSettings(range, updated);
  };

  const handleReset = () => {
    const defaultRange: [number, number] = [-10, 10];
    const defaultParams = { ...analysis.initialParams };
    setRange(defaultRange);
    setParams(defaultParams);
    persistSettings(defaultRange, defaultParams);
  };

  const handleSavePng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    exportPlotPng(canvas, `plot-${analysis.xVar}-${Date.now()}.png`);
  };

  const plotData = useMemo(() => {
    if (!analysis.drawable || !analysis.targetExpr) return { x: [], y: [] };
    return generatePlotData(analysis.targetExpr, analysis.xVar, params, range, 400);
  }, [analysis, params, range]);

  if (!open) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span>{t('plot.title') || 'グラフ描画'}</span>
        </span>
      }
    >
      <div className="space-y-4">
        {/* Expression preview */}
        <div className="rounded-2xl bg-paper px-4 py-3 text-center shadow-card">
          {analysis.latex ? (
            <Tex latex={analysis.latex} display className="text-lg font-medium" />
          ) : (
            <span className="text-muted">{t('plot.noLatex') || '数式がありません'}</span>
          )}
        </div>

        {!analysis.drawable ? (
          <div className="flex items-start gap-3 rounded-2xl bg-warn-soft/60 p-4 text-ink-soft">
            <Info size={20} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <p className="font-semibold text-ink">{t('plot.unsupported') || '描画できません'}</p>
              <p className="mt-1 text-sm">{analysis.reason}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chart Area */}
            <div className="h-72 w-full overflow-hidden rounded-2xl shadow-card">
              <ChartCanvas
                canvasRef={canvasRef}
                xData={plotData.x}
                yData={plotData.y}
                xRange={range}
                xVar={analysis.xVar}
                className="h-full border border-border"
              />
            </div>

            {/* Range controls */}
            <div className="space-y-2 rounded-2xl bg-paper p-3 shadow-card">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {t('plot.domain') || '表示範囲 (x)'}
                </span>
                <span className="text-xs tabular-nums text-muted">
                  [{range[0].toFixed(1)}, {range[1].toFixed(1)}]
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {PRESET_RANGES.map((preset) => {
                  const isSelected =
                    Math.abs(range[0] - preset.range[0]) < 0.01 && Math.abs(range[1] - preset.range[1]) < 0.01;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleRangeChange(preset.range)}
                      className={clsx(
                        'rounded-xl px-2.5 py-1 text-xs font-medium transition-colors',
                        isSelected ? 'bg-accent text-on-solid shadow-xs' : 'bg-sheet text-ink hover:bg-hover',
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Parameter sliders if any */}
            {Object.keys(analysis.paramsMeta).length > 0 && (
              <div className="space-y-3 rounded-2xl bg-paper p-3.5 shadow-card">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  <SlidersHorizontal size={14} />
                  <span>{t('plot.params') || 'パラメータ'}</span>
                </div>

                <div className="space-y-2.5">
                  {Object.entries(analysis.paramsMeta).map(([name, meta]) => {
                    const val = params[name] ?? meta.defaultValue;
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <span className="w-8 shrink-0 font-mono text-sm font-semibold">
                          <Tex latex={`${name}`} />
                        </span>
                        <input
                          type="range"
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          value={val}
                          onChange={(e) => handleParamChange(name, parseFloat(e.target.value))}
                          className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-sheet accent-accent"
                        />
                        <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-ink-soft">
                          {val.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={14} />}
                onClick={handleReset}
              >
                {t('plot.reset') || '初期化'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                onClick={handleSavePng}
              >
                {t('plot.savePng') || 'PNG保存'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
