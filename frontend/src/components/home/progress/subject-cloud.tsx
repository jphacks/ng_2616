'use client';

import clsx from 'clsx';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Subject, SubjectLevel } from '@/core/insights/aggregate';
import { useT } from '@/i18n';
import { radii, seed, settle, tick, type Bubble } from './bubbles';

/** the rest of a long tail would be dots too small to read or touch */
const MAX_BUBBLES = 28;
const HEIGHT = 460;
/** label sizes: as large as the circle allows, up to this share of its radius, and never below the floor */
const LABEL_MAX = 0.6;
const LABEL_MIN = 11;
/** names are set at this share of the largest size that fits, so they do not crowd the edge */
const LABEL_SCALE = 0.8;
const LINE_HEIGHT = 1.15;
/** how much of the circle's chord a line may use */
const LABEL_ROOM = 0.92;

let measurer: CanvasRenderingContext2D | null = null;
/** The rendered width of a line at 1px, from the page's own font (a rough estimate without canvas). */
function unitWidth(line: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return line.length * 0.54;
  measurer.font = `600 100px ${getComputedStyle(document.body).fontFamily}`;
  return measurer.measureText(line).width / 100;
}
/** pointer travel below this is a tap, not a drag */
const TAP_SLOP = 5;
/** the tooltip's height and half its widest width, to keep it inside the card */
const TIP_ROOM = 60;
const TIP_HALF = 112;

const FILL: Record<SubjectLevel, string> = {
  0: 'var(--color-viz-field)',
  1: 'var(--color-viz-subfield)',
  2: 'var(--color-viz-topic)',
};
const TEXT: Record<SubjectLevel, string> = {
  0: 'var(--color-on-solid)',
  1: 'var(--color-on-solid)',
  2: 'var(--color-ink)',
};

const labels = new Map<string, { lines: string[]; size: number } | null>();

/**
 * The name set inside the bubble on up to three lines, as large as fits, or null when even the
 * smallest size would not. A block of `rows` lines at size s, its widest line w·s, fits when
 * w·s ≤ 2·ROOM·√(r² − (rows·s·LINE_HEIGHT / 2)²), which gives the largest s directly.
 */
function fitLabel(tag: string, r: number): { lines: string[]; size: number } | null {
  const key = `${tag}|${Math.round(r)}`;
  if (labels.has(key)) return labels.get(key)!;
  // words break at spaces, and after a hyphen ("epsilon-" / "delta")
  const words = tag.split(/(?<=-)|\s+/).filter(Boolean);
  let best: { lines: string[]; size: number } | null = null;
  for (let rows = 1; rows <= Math.min(3, words.length); rows++) {
    const lines = splitInto(words, rows);
    const w = Math.max(...lines.map(unitWidth));
    const k = 2 * LABEL_ROOM;
    const fit = Math.min(LABEL_MAX * r, (k * r) / Math.sqrt(w * w + ((k * rows * LINE_HEIGHT) / 2) ** 2));
    if (fit < LABEL_MIN) continue;
    const size = Math.floor(Math.max(LABEL_MIN, fit * LABEL_SCALE));
    if (!best || size > best.size) best = { lines, size };
  }
  labels.set(key, best);
  return best;
}

/** Splits words into `rows` lines, keeping the longest line as short as possible. */
function splitInto(words: string[], rows: number): string[] {
  const join = (ws: string[]) => ws.join(' ').replace(/- /g, '-');
  if (rows === 1) return [join(words)];
  let best: string[] = [join(words)];
  let bestLen = Infinity;
  for (let i = 1; i <= words.length - rows + 1; i++) {
    const lines = [join(words.slice(0, i)), ...splitInto(words.slice(i), rows - 1)];
    const len = Math.max(...lines.map((l) => l.length));
    if (lines.length === rows && len < bestLen) {
      best = lines;
      bestLen = len;
    }
  }
  return best;
}

/**
 * The subject cloud: one bubble per tag, its area the number of notebooks filed under it. A
 * pull towards the center packs them, the big subjects in the middle. Bubbles can be pushed
 * around; tapping one shows the numbers for that subject only.
 */
export function SubjectCloud({ subjects, selected, onSelect }: { subjects: Subject[]; selected: string | null; onSelect: (tag: string | null) => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  // the animation loop outlives the render that started it: it reads the width from here
  const size = useRef(0);
  /** the simulation, moved in place every tick; renders draw the copy in `drawn` */
  const nodes = useRef<Bubble[]>([]);
  const alpha = useRef(0);
  const frame = useRef<number | null>(null);
  const [drawn, setDrawn] = useState<Bubble[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: string; pointer: number; startX: number; startY: number; moved: boolean } | null>(null);

  const shown = useMemo(() => subjects.slice(0, MAX_BUBBLES), [subjects]);
  const byTag = useMemo(() => new Map(shown.map((s) => [s.tag, s])), [shown]);
  const shape = shown.map((s) => `${s.tag}:${s.notebooks}`).join('|');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const publish = () => setDrawn(nodes.current.map((n) => ({ ...n })));

  useEffect(() => {
    size.current = width;
  }, [width]);

  const run = () => {
    if (frame.current !== null) return;
    const step = () => {
      tick(nodes.current, size.current, HEIGHT, alpha.current);
      alpha.current *= 0.985;
      publish();
      frame.current = alpha.current > 0.02 || drag.current ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
  };

  // a new set of subjects, or a new width: lay out again, keeping bubbles where they were
  useEffect(() => {
    if (!width || !shown.length) {
      nodes.current = [];
      publish();
      return;
    }
    const rs = radii(shown.map((s) => s.notebooks), width, HEIGHT, 0.5);
    const before = new Map(nodes.current.map((n) => [n.id, n]));
    const fresh = seed(shown.map((s, i) => ({ id: s.tag, r: rs[i]! })), width, HEIGHT);
    nodes.current = fresh.map((n) => {
      const old = before.get(n.id);
      if (old) return { ...n, x: Math.min(old.x, width - n.r), y: old.y };
      // new bubbles drift in from further out, so the pull is visible
      return reduced ? n : { ...n, x: width / 2 + (n.x - width / 2) * 1.8, y: HEIGHT / 2 + (n.y - HEIGHT / 2) * 1.8 };
    });
    if (reduced) {
      settle(nodes.current, width, HEIGHT);
      publish();
      return;
    }
    alpha.current = before.size ? 0.6 : 1;
    run();
    // run() reads width from this render; shape stands for shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, width, reduced]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const toSvg = (e: PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < TAP_SLOP) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    const n = nodes.current.find((b) => b.id === d.id);
    if (!n) return;
    const p = toSvg(e);
    n.held = { x: Math.max(n.r, Math.min(width - n.r, p.x)), y: Math.max(n.r, Math.min(HEIGHT - n.r, p.y)) };
    if (reduced) {
      tick(nodes.current, width, HEIGHT, 0.3);
      publish();
    } else {
      alpha.current = Math.max(alpha.current, 0.5);
      run();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    const n = nodes.current.find((b) => b.id === d.id);
    if (n) n.held = undefined;
    if (!d.moved) onSelect(selected === d.id ? null : d.id);
    else if (reduced) settle(nodes.current, width, HEIGHT, 60);
    else run();
    publish();
  };

  const onKeyDown = (e: KeyboardEvent, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelect(selected === id ? null : id);
  };

  const levelName = (l: SubjectLevel) => t(`progress.level.${l}` as const);
  const count = (n: number) => (n === 1 ? t('progress.notebooksOne') : t('progress.notebooksMany', { n }));
  const tip = hover ? drawn.find((n) => n.id === hover) : undefined;
  const tipSubject = hover ? byTag.get(hover) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div ref={box} className="relative w-full" style={{ height: HEIGHT }}>
        {width > 0 && shown.length > 0 && (
          <svg ref={svg} width={width} height={HEIGHT} className="block touch-none select-none" role="group" aria-label={t('progress.subjects')}>
            {drawn.map((n) => {
              const s = byTag.get(n.id);
              if (!s) return null;
              const label = fitLabel(s.tag, n.r);
              const on = selected === s.tag;
              const dim = selected !== null && !on;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  aria-label={`${s.tag}, ${count(s.notebooks)}, ${levelName(s.level)}`}
                  className={clsx('cursor-grab outline-none transition-opacity duration-base focus-visible:[&>circle:first-child]:stroke-accent', dim && 'opacity-35')}
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover((h) => (h === n.id ? null : h))}
                  onKeyDown={(e) => onKeyDown(e, n.id)}
                >
                  {/* the focus and selection ring sits just outside the fill */}
                  <circle r={n.r + 3} fill="none" stroke={on ? 'var(--color-ink)' : 'transparent'} strokeWidth={2} />
                  <circle r={n.r} fill={FILL[s.level]} />
                  {label && (
                    <text
                      textAnchor="middle"
                      fill={TEXT[s.level]}
                      fontSize={label.size}
                      fontWeight={600}
                      className="pointer-events-none"
                      dominantBaseline="central"
                    >
                      {label.lines.map((line, i) => (
                        <tspan key={i} x={0} y={(i - (label.lines.length - 1) / 2) * label.size * LINE_HEIGHT}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {tip && tipSubject && !dragging && (
          <div
            aria-hidden
            className={clsx(
              'pointer-events-none absolute z-lifted w-max max-w-56 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-sm text-on-solid shadow-float',
              tip.y - tip.r > TIP_ROOM && '-translate-y-full',
            )}
            // above the bubble when there is room, else below it; never past the card's sides
            style={{
              left: Math.max(TIP_HALF, Math.min(width - TIP_HALF, tip.x)),
              top: tip.y - tip.r > TIP_ROOM ? tip.y - tip.r - 8 : tip.y + tip.r + 8,
            }}
          >
            <span className="block font-semibold">{tipSubject.tag}</span>
            <span className="block text-on-solid/75">
              {levelName(tipSubject.level)} · {count(tipSubject.notebooks)}
            </span>
          </div>
        )}
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" aria-label={t('progress.levels')}>
        {([0, 1, 2] as const).map((l) => (
          <li key={l} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: FILL[l] }} />
            {levelName(l)}
          </li>
        ))}
      </ul>
      {/* the same numbers as a list, for screen readers */}
      <ul className="sr-only" aria-label={t('progress.subjectsList')}>
        {subjects.map((s) => (
          <li key={s.tag}>{`${s.tag}: ${count(s.notebooks)} (${levelName(s.level)})`}</li>
        ))}
      </ul>
    </div>
  );
}
