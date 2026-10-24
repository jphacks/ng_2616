'use client';

import type { Stroke, StrokePoint } from '@mn/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { scratchTargets } from '@/core/ink/scratch';
import { drawStroke, strokesBounds, strokesHit } from '@/core/ink/stroke';
import { INK_WEIGHTS, useDevicePrefs } from '@/core/prefs/device';
import type { Tool } from '@/core/store/notebook-store';
import { fingersDown, useSecondFinger } from './gestures';

export const LINE_HEIGHT = 140;
const MAX_HEIGHT = 560;
const GROW_MARGIN = 36;
const ERASER_RADIUS = 12;

// in auto mode, once a stylus is seen, touch becomes scrolling (palm rejection); shared by every line
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
  /** a pen stroke that scratched out existing ink, instead of adding a stroke */
  onScratchOut?: (ids: string[]) => void;
}

/**
 * Line-local ink surface. Pointer Events with capture, coalesced events and pressure;
 * logical CSS-pixel coordinates (spec §8.1). Buttons live outside the canvas.
 */
export function InkCanvas({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown, onScratchOut }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ id: number; points: StrokePoint[]; t0: number; touch: boolean } | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  const erasingByTouch = useRef(false);
  const scrolling = useRef<{ id: number; y: number; el: HTMLElement | null } | null>(null);
  const frame = useRef(0);
  // where a hovering Apple Pencil would touch down (iPads with Pencil hover)
  const hover = useRef<{ x: number; y: number } | null>(null);
  const inkSize = INK_WEIGHTS[useDevicePrefs((s) => s.inkWeight)];
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
      drawStroke(ctx, s.points, inkSize, true);
    }
    if (live.current) {
      ctx.fillStyle = '#1a2030';
      drawStroke(ctx, live.current.points, inkSize, false);
    }
    const h = hover.current;
    if (h && editable && !live.current && !hidden) {
      ctx.beginPath();
      if (tool === 'eraser') {
        ctx.strokeStyle = 'rgba(26,32,48,0.35)';
        ctx.lineWidth = 1;
        ctx.arc(h.x, h.y, ERASER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tool === 'pen') {
        ctx.fillStyle = 'rgba(26,32,48,0.3)';
        ctx.arc(h.x, h.y, inkSize / 2 + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [width, height, dim, inkSize, editable, tool]);

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

  // a second finger means a gesture (undo tap, pinch): drop what the first finger started
  useSecondFinger(() => {
    if (live.current?.touch) live.current = null;
    if (erasingByTouch.current) erasing.current = null;
    scrolling.current = null;
    schedule();
  });

  const local = (e: PointerEvent | React.PointerEvent, t0: number): StrokePoint => {
    const r = canvas.current!.getBoundingClientRect();
    const scale = r.width / width || 1;
    const pressure = e.pointerType === 'pen' || e.pointerType === 'touch' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, t: Math.round(e.timeStamp - t0), p: Number(pressure.toFixed(3)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') markPenSeen();
    if (e.pointerType === 'touch' && fingersDown() > 1) return;
    const mode = useDevicePrefs.getState().inputMode;
    const fingerScroll = tool === 'view' || (e.pointerType === 'touch' && (mode === 'pen' || (mode === 'auto' && penSeen)));
    if (fingerScroll || !editable) {
      if (!editable && tool !== 'view') onActivate?.();
      scrolling.current = { id: e.pointerId, y: e.clientY, el: scrollParent(wrap.current) };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    hover.current = null;
    onPenDown?.();
    if (tool === 'eraser') {
      erasing.current = new Set();
      erasingByTouch.current = e.pointerType === 'touch';
      eraseAt(e);
      return;
    }
    live.current = { id: e.pointerId, points: [], t0: e.timeStamp, touch: e.pointerType === 'touch' };
    live.current.points.push(local(e, e.timeStamp));
    schedule();
  };

  const eraseAt = (e: PointerEvent | React.PointerEvent) => {
    const p = local(e, 0);
    for (const id of strokesHit(strokesRef.current, p.x, p.y, ERASER_RADIUS)) erasing.current?.add(id);
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen' && e.buttons === 0) {
      hover.current = local(e, 0);
      schedule();
      return;
    }
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
    const scratched = useDevicePrefs.getState().scratchToErase && onScratchOut ? scratchTargets(l.points, strokesRef.current) : null;
    if (scratched) {
      const drop = new Set(scratched);
      pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !drop.has(s.id));
      strokesRef.current = strokesRef.current.filter((s) => !drop.has(s.id));
      draw();
      onScratchOut!(scratched);
    } else if (l.points.length > 0) {
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
        onPointerLeave={() => {
          if (!hover.current) return;
          hover.current = null;
          schedule();
        }}
      />
    </div>
  );
}
