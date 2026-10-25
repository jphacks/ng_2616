/**
 * A tiny force layout for the subject cloud: every bubble is pulled towards the center, the
 * bigger ones harder, and bubbles never overlap. Seeded on a spiral with the biggest first, so
 * the big subjects end up in the middle and the small ones around them.
 */
export interface Bubble {
  id: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** held by the pointer: the bubble stays here and pushes the others away */
  held?: { x: number; y: number };
}

/** gap between neighbouring bubbles, in px */
export const BUBBLE_GAP = 3;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_R = 30;

/** Radii with area proportional to the value, scaled so the bubbles cover about `fill` of the box. */
export function radii(values: readonly number[], width: number, height: number, fill = 0.42): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (!sum) return values.map(() => MIN_R);
  const k = Math.sqrt((fill * width * height) / (Math.PI * sum));
  const max = Math.min(width, height) * 0.3;
  return values.map((v) => Math.max(MIN_R, Math.min(max, k * Math.sqrt(v))));
}

export function seed(items: readonly { id: string; r: number }[], width: number, height: number): Bubble[] {
  const order = [...items].sort((a, b) => b.r - a.r);
  const step = (order[0]?.r ?? MIN_R) * 0.9;
  return order.map((it, i) => {
    const d = i === 0 ? 0 : step * Math.sqrt(i) * 1.6;
    const a = i * GOLDEN_ANGLE;
    return { id: it.id, r: it.r, x: width / 2 + d * Math.cos(a), y: height / 2 + d * Math.sin(a), vx: 0, vy: 0 };
  });
}

/** One tick. `alpha` cools from 1 towards 0 as the layout settles. */
export function tick(nodes: Bubble[], width: number, height: number, alpha: number) {
  const cx = width / 2;
  const cy = height / 2;
  const rMax = Math.max(...nodes.map((n) => n.r), 1);
  for (const n of nodes) {
    if (n.held) {
      n.x = n.held.x;
      n.y = n.held.y;
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    const pull = 0.012 * alpha * (0.4 + n.r / rMax);
    n.vx = (n.vx + (cx - n.x) * pull) * 0.82;
    n.vy = (n.vy + (cy - n.y) * pull) * 0.82;
    n.x += n.vx;
    n.y += n.vy;
  }
  for (let pass = 0; pass < 3; pass++) collide(nodes);
  for (const n of nodes) {
    if (n.held) continue;
    n.x = Math.max(n.r, Math.min(width - n.r, n.x));
    n.y = Math.max(n.r, Math.min(height - n.r, n.y));
  }
}

/** Overlapping pairs move apart, the smaller bubble more (mass grows with area); a held one stays. */
function collide(nodes: Bubble[]) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      const min = a.r + b.r + BUBBLE_GAP;
      if (d >= min || (a.held && b.held)) continue;
      if (d < 1e-6) {
        // exactly on top of each other: part them in a fixed direction
        dx = 1;
        dy = 0;
        d = 1;
      }
      const push = (min - d) / d;
      const ma = a.r * a.r;
      const mb = b.r * b.r;
      const wa = a.held ? 0 : b.held ? 1 : mb / (ma + mb);
      const wb = b.held ? 0 : a.held ? 1 : ma / (ma + mb);
      a.x -= dx * push * wa;
      a.y -= dy * push * wa;
      b.x += dx * push * wb;
      b.y += dy * push * wb;
    }
  }
}

/** Runs the layout to rest without drawing it (reduced motion, first paint, tests). */
export function settle(nodes: Bubble[], width: number, height: number, ticks = 320) {
  for (let i = 0; i < ticks; i++) tick(nodes, width, height, 1 - i / ticks);
}

/** True when any two bubbles overlap by more than half a pixel. */
export function overlapping(nodes: readonly Bubble[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < a.r + b.r - 0.5) return true;
    }
  }
  return false;
}
