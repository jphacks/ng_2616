'use client';

import type { Stroke, StrokePoint } from '@mn/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { drawStroke, strokesBounds, strokesHit } from '@/core/ink/stroke';
import type { Tool } from '@/core/store/notebook-store';

export const LINE_HEIGHT = 140;
const MAX_HEIGHT = 560;
const GROW_MARGIN = 36;

// once a stylus is seen, touch becomes scrolling (palm rejection); shared by every line
let penSeen = false;
const markPenSeen = () => {
  penSeen = true;
};

/** Height a line needs for its ink (rows grow as you write, spec §8.1). */
export function inkHeight(strokes: readonly Stroke[]): number {
  const b = strokesBounds(strokes);
  return Math.min(MAX_HEIGHT, Math.max(LINE_HEIGHT, b ? b.maxY + GROW_MARGIN : LINE_HEIGHT));
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur && !cur.dataset.scrollContainer) cur = cur.parentElement;
  return cur;
}

interface Props {
  strokes: readonly Stroke[];
  editable: boolean;
  tool: Tool;
  dim?: boolean;
  onStroke?: (s: Stroke) => void;
  onErase?: (ids: string[]) => void;
  onActivate?: () => void;
  onPenDown?: () => void;
}

/**
 * Line-local ink surface. Pointer Events with capture, coalesced events and pressure;
 * logical CSS-pixel coordinates (spec §8.1). Buttons live outside the canvas.
 */
export function InkCanvas({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ id: number; points: StrokePoint[]; t0: number } | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  const scrolling = useRef<{ id: number; y: number; el: HTMLElement | null } | null>(null);
  const frame = useRef(0);
  // every draw reads the latest strokes from strokesRef.
  // pendingStrokesRef holds optimistically added strokes that React has not yet passed down in props.strokes.
  // This prevents fast consecutive strokes from being wiped out by an in-flight React re-render.
  const strokesRef = useRef(strokes);
  const pendingStrokesRef = useRef<Stroke[]>([]);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(() => inkHeight(strokes));

  useEffect(() => setHeight((h) => Math.max(inkHeight(strokes), live.current ? h : 0)), [strokes]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const hidden = erasing.current;
    const list = strokesRef.current;
    for (const s of list) {
      ctx.fillStyle = hidden?.has(s.id) ? 'rgba(26,32,48,0.18)' : dim ? 'rgba(26,32,48,0.55)' : '#1a2030';
      drawStroke(ctx, s.points, undefined, true);
    }
    if (live.current) {
      ctx.fillStyle = '#1a2030';
      drawStroke(ctx, live.current.points, undefined, false);
    }
  }, [width, height, dim]);

  useLayoutEffect(() => {
    if (strokes.length === 0 && !live.current) {
      pendingStrokesRef.current = [];
      strokesRef.current = [];
    } else {
      const confirmed = new Set(strokes.map((s) => s.id));
      if (pendingStrokesRef.current.length > 0) {
        pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !confirmed.has(s.id));
      }
      strokesRef.current = [...strokes, ...pendingStrokesRef.current];
    }
    draw();
  }, [strokes, draw]);

  const schedule = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  };

  const local = (e: PointerEvent | React.PointerEvent, t0: number): StrokePoint => {
    const r = canvas.current!.getBoundingClientRect();
    const scale = r.width / width || 1;
    const pressure = e.pointerType === 'pen' || e.pointerType === 'touch' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, t: Math.round(e.timeStamp - t0), p: Number(pressure.toFixed(3)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') markPenSeen();
    const fingerScroll = tool === 'view' || (e.pointerType === 'touch' && penSeen);
    if (fingerScroll || !editable) {
      if (!editable && tool !== 'view') onActivate?.();
      scrolling.current = { id: e.pointerId, y: e.clientY, el: scrollParent(wrap.current) };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onPenDown?.();
    if (tool === 'eraser') {
      erasing.current = new Set();
      eraseAt(e);
      return;
    }
    live.current = { id: e.pointerId, points: [], t0: e.timeStamp };
    live.current.points.push(local(e, e.timeStamp));
    schedule();
  };

  const eraseAt = (e: PointerEvent | React.PointerEvent) => {
    const p = local(e, 0);
    for (const id of strokesHit(strokesRef.current, p.x, p.y)) erasing.current?.add(id);
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sc = scrolling.current;
    if (sc && sc.id === e.pointerId) {
      if (sc.el) sc.el.scrollTop -= e.clientY - sc.y;
      sc.y = e.clientY;
      return;
    }
    if (erasing.current) {
      eraseAt(e);
      return;
    }
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = local(ev, l.t0);
      l.points.push(p);
      if (p.y > height - GROW_MARGIN && height < MAX_HEIGHT) setHeight(Math.min(MAX_HEIGHT, p.y + GROW_MARGIN * 2));
    }
    if (l.points.length > 20000) l.points.length = 20000;
    schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore in case capture was lost or not set
    }
    if (scrolling.current?.id === e.pointerId) {
      scrolling.current = null;
      return;
    }
    if (erasing.current) {
      const ids = [...erasing.current];
      erasing.current = null;
      if (ids.length) {
        const drop = new Set(ids);
        pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !drop.has(s.id));
        strokesRef.current = strokesRef.current.filter((s) => !drop.has(s.id));
        onErase?.(ids);
      }
      draw();
      schedule();
      return;
    }
    const l = live.current;
    if (!l || l.id !== e.pointerId) return;
    live.current = null;
    if (l.points.length > 0) {
      const stroke = { id: shortId('s'), points: l.points };
      // optimistically append to both pendingStrokes and strokesRef so the stroke is permanently visible at 0ms
      pendingStrokesRef.current.push(stroke);
      strokesRef.current = [...strokesRef.current, stroke];
      draw();
      onStroke?.(stroke);
    }
    schedule();
  };

  return (
    <div ref={wrap} className="relative w-full" style={{ height }}>
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: 'none', cursor: editable ? (tool === 'eraser' ? 'cell' : tool === 'view' ? 'grab' : 'crosshair') : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </div>
  );
}
