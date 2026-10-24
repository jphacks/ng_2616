import type { Stroke, StrokePoint } from '@mn/contracts';
import { strokesHit } from './stroke';

// a scratch-out is a fast back-and-forth: several reversals along its main axis, a path
// much longer than the area it covers, drawn over existing ink
const MIN_POINTS = 16;
const MIN_SPAN = 24;
const MIN_REVERSALS = 5;
const MIN_PATH_RATIO = 3.5;
// a turn shorter than this is jitter, not a reversal
const TURN_HYSTERESIS = 6;
const HIT_RADIUS = 6;

/**
 * Ids of the strokes a scratch-out gesture covers, or null when `points` is ordinary
 * writing. Letters such as "w" or "m" have too few reversals to qualify.
 */
export function scratchTargets(points: readonly StrokePoint[], strokes: readonly Stroke[]): string[] | null {
  if (points.length < MIN_POINTS || strokes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    if (i > 0) length += Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (span < MIN_SPAN || length < span * MIN_PATH_RATIO) return null;

  const along = maxX - minX >= maxY - minY ? (p: StrokePoint) => p.x : (p: StrokePoint) => p.y;
  let reversals = 0;
  let direction = 0;
  // the furthest point reached in the current direction
  let extreme = along(points[0]!);
  for (const p of points) {
    const v = along(p);
    if (direction === 0) {
      if (Math.abs(v - extreme) > TURN_HYSTERESIS) {
        direction = Math.sign(v - extreme);
        extreme = v;
      }
    } else if (direction > 0 ? v > extreme : v < extreme) {
      extreme = v;
    } else if (Math.abs(v - extreme) > TURN_HYSTERESIS) {
      reversals++;
      direction = -direction;
      extreme = v;
    }
  }
  if (reversals < MIN_REVERSALS) return null;

  const hit = new Set<string>();
  for (let i = 0; i < points.length; i += 2) {
    for (const id of strokesHit(strokes, points[i]!.x, points[i]!.y, HIT_RADIUS)) hit.add(id);
  }
  return hit.size ? [...hit] : null;
}
