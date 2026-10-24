/**
 * Unit tests for inkHeight calculation and auto-shrink behavior.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Stroke } from '@mn/contracts';
import { inkHeight, LINE_HEIGHT, MAX_HEIGHT } from '../../src/core/ink/height';

const strokeAt = (id: string, maxY: number): Stroke => ({
  id,
  points: [
    { x: 10, y: 10, t: 0, p: 0.5 },
    { x: 10, y: maxY, t: 10, p: 0.5 },
  ],
});

test('inkHeight: returns default line height (140) when there are no strokes', () => {
  assert.equal(inkHeight([]), LINE_HEIGHT);
  assert.equal(inkHeight([]), 140);
});

test('inkHeight: stays at default height (140) when stroke bottom is within bounds (<= 124)', () => {
  assert.equal(inkHeight([strokeAt('s1', 50)]), 140);
  assert.equal(inkHeight([strokeAt('s2', 100)]), 140);
  assert.equal(inkHeight([strokeAt('s3', 124)]), 140);
});

test('inkHeight: expands beyond default height with 16px padding when stroke bottom exceeds 124', () => {
  // 130 + 16 = 146
  assert.equal(inkHeight([strokeAt('s1', 130)]), 146);
  // 200 + 16 = 216
  assert.equal(inkHeight([strokeAt('s2', 200)]), 216);
  // Multi-stroke: picks the maximum Y
  assert.equal(inkHeight([strokeAt('s1', 80), strokeAt('s2', 250)]), 266);
});

test('inkHeight: shrinks back when lower strokes are removed (erased or undone)', () => {
  const topStroke = strokeAt('top', 80);
  const bottomStroke = strokeAt('bottom', 250);

  // Both present: expanded to 250 + 16 = 266
  assert.equal(inkHeight([topStroke, bottomStroke]), 266);

  // Bottom stroke removed: shrinks back to default 140
  assert.equal(inkHeight([topStroke]), 140);

  // All removed: shrinks to default 140
  assert.equal(inkHeight([]), 140);
});

test('inkHeight: caps at MAX_HEIGHT (560)', () => {
  assert.equal(inkHeight([strokeAt('huge', 600)]), MAX_HEIGHT);
  assert.equal(inkHeight([strokeAt('huge', 1000)]), MAX_HEIGHT);
});
