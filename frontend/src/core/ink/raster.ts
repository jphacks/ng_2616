'use client';

import type { Stroke } from '@mn/contracts';
import { drawStroke, INK_SIZE, strokesBounds } from './stroke';

const MAX_SIDE = 1000;
const MAX_BYTES = 1024 * 1024;
const PAD = 24;

/**
 * The bounded recognition image (spec §8.2, §5.1): cropped to the ink, white background,
 * longest side ≤ 1000 px, PNG (JPEG fallback) ≤ 1 MiB decoded.
 */
export function rasterizeStrokes(strokes: readonly Stroke[]): { mime: 'image/png' | 'image/jpeg'; data: string } | null {
  const b = strokesBounds(strokes);
  if (!b) return null;
  const w = b.maxX - b.minX + PAD * 2;
  const h = b.maxY - b.minY + PAD * 2;
  // enlarge small writing for legibility, shrink large writing to the limit
  const scale = Math.min(MAX_SIDE / Math.max(w, h), 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  // black on white regardless of the theme: this image is input for handwriting recognition
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111111';
  ctx.setTransform(scale, 0, 0, scale, (PAD - b.minX) * scale, (PAD - b.minY) * scale);
  for (const s of strokes) drawStroke(ctx, s.points, INK_SIZE * 1.15);
  let url = canvas.toDataURL('image/png');
  let mime: 'image/png' | 'image/jpeg' = 'image/png';
  if ((url.length * 3) / 4 > MAX_BYTES) {
    url = canvas.toDataURL('image/jpeg', 0.85);
    mime = 'image/jpeg';
  }
  const data = url.slice(url.indexOf(',') + 1);
  if ((data.length * 3) / 4 > MAX_BYTES) return null;
  return { mime, data };
}
