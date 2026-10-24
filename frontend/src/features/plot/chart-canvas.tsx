'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { drawChart } from './chart-renderer';

interface ChartCanvasProps {
  xData: number[];
  yData: (number | null)[];
  xRange: [number, number];
  xVar: string;
  className?: string;
  onHoverPoint?: (pt: { x: number; y: number } | null) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function ChartCanvas({
  xData,
  yData,
  xRange,
  xVar,
  className,
  onHoverPoint,
  canvasRef: externalRef,
}: ChartCanvasProps) {
  const internalRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = externalRef || internalRef;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; px: number; py: number } | null>(null);

  const validY = yData.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v));
  let yMin = -10;
  let yMax = 10;
  if (validY.length > 0) {
    const sorted = [...validY].sort((a, b) => a - b);
    const q10 = sorted[Math.floor(sorted.length * 0.05)]!;
    const q90 = sorted[Math.floor(sorted.length * 0.95)]!;
    const pad = Math.max((q90 - q10) * 0.2, 1);
    yMin = Math.max(q10 - pad, -50);
    yMax = Math.min(q90 + pad, 50);

    if (yMin > 0 && yMin < 5) yMin = 0;
    if (yMax < 0 && yMax > -5) yMax = 0;
    if (yMax - yMin < 2) {
      yMin -= 1;
      yMax += 1;
    }
  }

  const [xMin, xMax] = xRange;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      drawChart(ctx, {
        width: canvas.width,
        height: canvas.height,
        xData,
        yData,
        xMin,
        xMax,
        yMin,
        yMax,
        hoveredPoint: hoveredPoint ? { px: hoveredPoint.px, py: hoveredPoint.py } : null,
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasRef, xData, yData, xMin, xMax, yMin, yMax, hoveredPoint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawChart(ctx, {
      width: canvas.width,
      height: canvas.height,
      xData,
      yData,
      xMin,
      xMax,
      yMin,
      yMax,
      hoveredPoint: hoveredPoint ? { px: hoveredPoint.px, py: hoveredPoint.py } : null,
    });
  }, [canvasRef, xData, yData, xMin, xMax, yMin, yMax, hoveredPoint]);

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;

    const padLeft = 45;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;
    const plotWidth = rect.width - padLeft - padRight;
    const plotHeight = rect.height - padTop - padBottom;

    if (clientX < padLeft || clientX > padLeft + plotWidth) {
      setHoveredPoint(null);
      onHoverPoint?.(null);
      return;
    }

    const ratio = (clientX - padLeft) / plotWidth;
    const targetX = xMin + ratio * (xMax - xMin);

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < xData.length; i++) {
      const dist = Math.abs(xData[i]! - targetX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const curY = yData[bestIdx];
    if (curY !== null && curY !== undefined && !isNaN(curY) && isFinite(curY)) {
      const curX = xData[bestIdx]!;
      const sx = padLeft + ((curX - xMin) / (xMax - xMin)) * plotWidth;
      const sy = padTop + plotHeight - ((curY - yMin) / (yMax - yMin)) * plotHeight;

      const pt = { x: curX, y: curY, px: sx, py: sy };
      setHoveredPoint(pt);
      onHoverPoint?.({ x: curX, y: curY });
    } else {
      setHoveredPoint(null);
      onHoverPoint?.(null);
    }
  };

  const handlePointerLeave = () => {
    setHoveredPoint(null);
    onHoverPoint?.(null);
  };

  return (
    <div ref={containerRef} className={clsx('relative w-full select-none overflow-hidden rounded-2xl bg-paper', className)}>
      <canvas
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="h-full w-full touch-none"
      />

      {hoveredPoint && (
        <div
          className="pointer-events-none absolute z-raised -translate-x-1/2 -translate-y-8 rounded-lg bg-sheet/95 px-2.5 py-1 text-xs font-semibold tabular-nums shadow-card ring-1 ring-border backdrop-blur-xs"
          style={{
            left: `${hoveredPoint.px}px`,
            top: `${Math.max(hoveredPoint.py, 36)}px`,
          }}
        >
          {xVar} = {hoveredPoint.x.toFixed(2)}, y = {hoveredPoint.y.toFixed(2)}
        </div>
      )}
    </div>
  );
}
