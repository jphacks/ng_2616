import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Stroke, StrokePoint } from '@mn/contracts';
import { scratchTargets } from '../../src/core/ink/scratch';

const pts = (xy: [number, number][]): StrokePoint[] => xy.map(([x, y], i) => ({ x, y, t: i * 8, p: 0.5 }));

/** A polyline sampled every few pixels, like a pen produces. */
function path(corners: [number, number][]): StrokePoint[] {
  const out: [number, number][] = [];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]!;
    const [bx, by] = corners[i]!;
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 4));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push(corners[corners.length - 1]!);
  return pts(out);
}

const word: Stroke = { id: 'w1', points: path([[100, 60], [180, 60]]) };
const other: Stroke = { id: 'far', points: path([[400, 60], [480, 60]]) };

test('a zig-zag over a stroke scratches it out', () => {
  const zigzag = path([[100, 50], [180, 70], [100, 50], [180, 70], [100, 50], [180, 70], [100, 55]]);
  assert.deepEqual(scratchTargets(zigzag, [word, other]), ['w1']);
});

test('a zig-zag over empty paper is ordinary writing', () => {
  const zigzag = path([[250, 50], [330, 70], [250, 50], [330, 70], [250, 50], [330, 70]]);
  assert.equal(scratchTargets(zigzag, [word, other]), null);
});

test('letters with a few turns, such as "w" or "m", are not scratch-outs', () => {
  const w = path([[100, 40], [115, 80], [130, 50], [145, 80], [160, 40]]);
  assert.equal(scratchTargets(w, [word]), null);
  const m = path([[100, 80], [110, 45], [125, 80], [140, 45], [155, 80]]);
  assert.equal(scratchTargets(m, [word]), null);
});

test('a straight line through ink is not a scratch-out', () => {
  assert.equal(scratchTargets(path([[90, 60], [200, 60]]), [word]), null);
});
