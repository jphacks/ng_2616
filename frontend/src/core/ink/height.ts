import type { Stroke } from '@mn/contracts';
import { strokesBounds } from './stroke';

export const LINE_HEIGHT = 140;
export const MAX_HEIGHT = 560;
export const PADDING_BOTTOM = 16;

/** Height a line needs for its ink (rows grow as you write, spec §8.1). */
export function inkHeight(strokes: readonly Stroke[]): number {
  const b = strokesBounds(strokes);
  if (!b) return LINE_HEIGHT;
  const needed = Math.ceil(b.maxY + PADDING_BOTTOM);
  return Math.min(MAX_HEIGHT, Math.max(LINE_HEIGHT, needed));
}
