export interface RenderOptions {
  width: number;
  height: number;
  xData: number[];
  yData: (number | null)[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  hoveredPoint: { px: number; py: number } | null;
}

export function drawChart(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  const { width, height, xData, yData, xMin, xMax, yMin, yMax, hoveredPoint } = opts;
  ctx.clearRect(0, 0, width, height);

  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const toScreenX = (x: number) => padLeft + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const toScreenY = (y: number) => padTop + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  // 1. Background grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(150, 150, 150, 0.15)';
  ctx.fillStyle = 'rgba(120, 120, 120, 0.8)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // X-grid & ticks
  const xSpan = xMax - xMin;
  const xStep = Math.pow(10, Math.floor(Math.log10(xSpan / 6)));
  const startX = Math.ceil(xMin / xStep) * xStep;

  for (let x = startX; x <= xMax; x += xStep) {
    const sx = toScreenX(x);
    ctx.beginPath();
    ctx.moveTo(sx, padTop);
    ctx.lineTo(sx, padTop + plotHeight);
    ctx.stroke();

    const label = Math.abs(x) < 1e-9 ? '0' : Number(x.toFixed(2)).toString();
    ctx.fillText(label, sx, padTop + plotHeight + 6);
  }

  // Y-grid & ticks
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ySpan = yMax - yMin;
  const yStep = Math.pow(10, Math.floor(Math.log10(ySpan / 6)));
  const startY = Math.ceil(yMin / yStep) * yStep;

  for (let y = startY; y <= yMax; y += yStep) {
    const sy = toScreenY(y);
    ctx.beginPath();
    ctx.moveTo(padLeft, sy);
    ctx.lineTo(padLeft + plotWidth, sy);
    ctx.stroke();

    const label = Math.abs(y) < 1e-9 ? '0' : Number(y.toFixed(2)).toString();
    ctx.fillText(label, padLeft - 6, sy);
  }

  // 2. Axes (x=0, y=0)
  ctx.strokeStyle = 'rgba(100, 100, 100, 0.45)';
  ctx.lineWidth = 1.5;

  if (yMin <= 0 && 0 <= yMax) {
    const yZero = toScreenY(0);
    ctx.beginPath();
    ctx.moveTo(padLeft, yZero);
    ctx.lineTo(padLeft + plotWidth, yZero);
    ctx.stroke();
  }

  if (xMin <= 0 && 0 <= xMax) {
    const xZero = toScreenX(0);
    ctx.beginPath();
    ctx.moveTo(xZero, padTop);
    ctx.lineTo(xZero, padTop + plotHeight);
    ctx.stroke();
  }

  // 3. Draw curve
  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotWidth, plotHeight);
  ctx.clip();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#2563eb';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let isDrawing = false;
  for (let i = 0; i < xData.length; i++) {
    const x = xData[i];
    const y = yData[i];

    if (x === undefined || y === null || y === undefined || isNaN(y) || !isFinite(y)) {
      isDrawing = false;
      continue;
    }

    const sx = toScreenX(x);
    const sy = toScreenY(y);

    if (!isDrawing) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      isDrawing = true;
    } else {
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }

  // 4. Highlight hovered point
  if (hoveredPoint) {
    const { px, py } = hoveredPoint;
    if (px >= padLeft && px <= padLeft + plotWidth && py >= padTop && py <= padTop + plotHeight) {
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(px, padTop);
      ctx.lineTo(px, padTop + plotHeight);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padLeft, py);
      ctx.lineTo(padLeft + plotWidth, py);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function drawHoverOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hoveredPoint: { px: number; py: number } | null,
): void {
  ctx.clearRect(0, 0, width, height);
  if (!hoveredPoint) return;

  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const { px, py } = hoveredPoint;
  if (px >= padLeft && px <= padLeft + plotWidth && py >= padTop && py <= padTop + plotHeight) {
    ctx.save();
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(px, padTop);
    ctx.lineTo(px, padTop + plotHeight);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(padLeft, py);
    ctx.lineTo(padLeft + plotWidth, py);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
}

export function exportPlotPng(canvas: HTMLCanvasElement, filename: string): void {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  const dataUrl = exportCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
