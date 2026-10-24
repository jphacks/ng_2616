import type { Stroke, StrokePoint } from '@mn/contracts';
import { getStroke } from 'perfect-freehand';

export const INK_SIZE = 3.4;

export function strokeOutline(points: StrokePoint[], size = INK_SIZE, last = true): number[][] {
  return getStroke(
    points.map((p) => [p.x, p.y, p.p]),
    {
      size,
      thinning: 0.55,
      smoothing: last ? 0.35 : 0.15,
      // Stylus/Apple Pencil zero-latency: low streamline prevents trailing behind cursor
      // During active live drawing, streamline is minimal (0.04) so ink stays glued to the pen tip.
      // Once stroke is finished (last = true), mild streamline (0.12) smooths the final line.
      streamline: last ? 0.12 : 0.04,
      simulatePressure: points.every((p) => p.p === 0.5),
      last,
    },
  );
}

/** Perfect-freehand outline → SVG path data (quadratic smoothing). */
export function outlineToPath(outline: number[][]): string {
  if (outline.length < 2) return '';
  const avg = (a: number, b: number) => (a + b) / 2;
  let d = `M ${outline[0]![0]!.toFixed(2)} ${outline[0]![1]!.toFixed(2)} Q`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = outline[(i + 1) % outline.length]!;
    d += ` ${x0!.toFixed(2)} ${y0!.toFixed(2)} ${avg(x0!, x1!).toFixed(2)} ${avg(y0!, y1!).toFixed(2)}`;
  }
  return `${d} Z`;
}

// finished strokes never change, so their outline is computed once per width instead of on every frame
const pathCache = new WeakMap<StrokePoint[], Map<number, Path2D>>();

export function drawStroke(ctx: CanvasRenderingContext2D, points: StrokePoint[], size = INK_SIZE, last = true) {
  if (points.length === 0) return;
  if (points.length === 1) {
    const p = points[0]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (last) {
    let bySize = pathCache.get(points);
    let path = bySize?.get(size);
    if (!path) {
      path = new Path2D(outlineToPath(strokeOutline(points, size, last)));
      if (!bySize) pathCache.set(points, (bySize = new Map()));
      bySize.set(size, path);
    }
    ctx.fill(path);
    return;
  }

  // Live drawing: bypass SVG string generation and Path2D parsing for zero-latency, GC-free direct rendering
  const outline = strokeOutline(points, size, false);
  if (outline.length < 2) return;
  const avg = (a: number, b: number) => (a + b) / 2;
  ctx.beginPath();
  ctx.moveTo(outline[0]![0]!, outline[0]![1]!);
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = outline[(i + 1) % outline.length]!;
    ctx.quadraticCurveTo(x0!, y0!, avg(x0!, x1!), avg(y0!, y1!));
  }
  ctx.fill();
}

function distToSegment(px: number, py: number, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Stroke eraser: ids of whole strokes passing within `radius` of the point. */
export function strokesHit(strokes: readonly Stroke[], x: number, y: number, radius = 12): string[] {
  const hit: string[] = [];
  for (const s of strokes) {
    const pts = s.points;
    if (pts.length === 1 && Math.hypot(pts[0]!.x - x, pts[0]!.y - y) <= radius) hit.push(s.id);
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(x, y, pts[i - 1]!, pts[i]!) <= radius) {
        hit.push(s.id);
        break;
      }
    }
  }
  return hit;
}

export function strokesBounds(strokes: readonly Stroke[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
