'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { drawChart, drawHoverOverlay } from './chart-renderer';

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
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; px: number; py: number } | null>(null);

  const [xMin, xMax] = xRange;

  const { yMin, yMax } = useMemo(() => {
    const validY = yData.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v));
    if (validY.length === 0) {
      return { yMin: -10, yMax: 10 };
    }

    const sorted = [...validY].sort((a, b) => a - b);
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    const q05 = sorted[Math.floor(sorted.length * 0.05)]!;
    const q95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const iqrSpan = q95 - q05;
    const totalSpan = max - min;

    let rawMin = min;
    let rawMax = max;
    // For asymptotic functions (like tan(x) or 1/x) where outlier points spike dramatically,
    // clip to the 5th-95th percentile with padding so the curve doesn't collapse to a flat line.
    // For smooth functions (like y = 100x), totalSpan and iqrSpan are comparable, so min/max are preserved.
    if (iqrSpan > 0 && totalSpan > iqrSpan * 4) {
      rawMin = q05;
      rawMax = q95;
    }

    const pad = Math.max((rawMax - rawMin) * 0.12, 1);
    let computedMin = rawMin - pad;
    let computedMax = rawMax + pad;

    // Anchor near 0 if zero-crossing is very close
    if (computedMin > 0 && computedMin < pad * 2) computedMin = 0;
    if (computedMax < 0 && computedMax > -pad * 2) computedMax = 0;
    if (computedMax - computedMin < 2) {
      computedMin -= 1;
      computedMax += 1;
    }

    return { yMin: computedMin, yMax: computedMax };
  }, [yData]);

  // 1. ResizeObserver: manages canvas dimensions when container size changes
  useEffect(() => {
    const container = containerRef.current;
    const baseCanvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !baseCanvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;

      sizeRef.current = { width, height };
      const dpr = window.devicePixelRatio || 1;

      baseCanvas.width = Math.round(width * dpr);
      baseCanvas.height = Math.round(height * dpr);
      baseCanvas.style.width = `${width}px`;
      baseCanvas.style.height = `${height}px`;

      if (overlayCanvas) {
        overlayCanvas.width = Math.round(width * dpr);
        overlayCanvas.height = Math.round(height * dpr);
        overlayCanvas.style.width = `${width}px`;
        overlayCanvas.style.height = `${height}px`;
      }

      const ctx = baseCanvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChart(ctx, {
          width,
          height,
          xData,
          yData,
          xMin,
          xMax,
          yMin,
          yMax,
          hoveredPoint: null,
        });
      }

      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d');
        if (overlayCtx) {
          overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawHoverOverlay(overlayCtx, width, height, null);
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasRef, xData, yData, xMin, xMax, yMin, yMax]);

  // 2. Redraw base chart when data or range changes (without re-creating ResizeObserver)
  useEffect(() => {
    const baseCanvas = canvasRef.current;
    if (!baseCanvas) return;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const ctx = baseCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(ctx, {
      width,
      height,
      xData,
      yData,
      xMin,
      xMax,
      yMin,
      yMax,
      hoveredPoint: null,
    });
  }, [canvasRef, xData, yData, xMin, xMax, yMin, yMax]);

  // 3. Redraw hover crosshairs on the lightweight overlay canvas
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHoverOverlay(ctx, width, height, hoveredPoint);
  }, [hoveredPoint]);

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
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
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={clsx('relative w-full select-none overflow-hidden rounded-2xl bg-paper touch-none', className)}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
      />
      <canvas
        ref={overlayCanvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
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
