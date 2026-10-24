'use client';

import type { Stroke, StrokePoint } from '@mn/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { drawStroke, strokesBounds, strokesHit } from '@/core/ink/stroke';
import { useDevicePrefs } from '@/core/prefs/device';
import type { Tool } from '@/core/store/notebook-store';

export const LINE_HEIGHT = 140;
const MAX_HEIGHT = 560;
const GROW_MARGIN = 36;

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
}

interface LiveStroke {
  id: string;
  points: StrokePoint[];
  t0: number;
}

/**
 * Line-local ink surface. Pointer Events with capture, coalesced events and pressure;
 * logical CSS-pixel coordinates (spec §8.1). Buttons live outside the canvas.
 */
export function InkCanvas({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const activeStrokes = useRef<Map<number, LiveStroke>>(new Map());
  const erasing = useRef<Set<string> | null>(null);
  const scrolling = useRef<{ id: number; y: number; el: HTMLElement | null } | null>(null);
  const frame = useRef(0);
  const rectRef = useRef<DOMRect | null>(null);
  // every draw reads the latest strokes from strokesRef.
  // pendingStrokesRef holds optimistically added strokes that React has not yet passed down in props.strokes.
  // This prevents fast consecutive strokes from being wiped out by an in-flight React re-render.
  const strokesRef = useRef(strokes);
  const pendingStrokesRef = useRef<Stroke[]>([]);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(() => inkHeight(strokes));

  const propsRef = useRef({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown });
  const widthRef = useRef(width);
  const heightRef = useRef(height);

  useLayoutEffect(() => {
    propsRef.current = { strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown };
    widthRef.current = width;
    heightRef.current = height;
  });

  useEffect(() => setHeight((h) => Math.max(inkHeight(strokes), activeStrokes.current.size > 0 ? h : 0)), [strokes]);

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
    for (const live of activeStrokes.current.values()) {
      ctx.fillStyle = '#1a2030';
      drawStroke(ctx, live.points, undefined, false);
    }
  }, [width, height, dim]);

  useLayoutEffect(() => {
    const confirmed = new Set(strokes.map((s) => s.id));
    if (pendingStrokesRef.current.length > 0) {
      pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !confirmed.has(s.id));
    }
    strokesRef.current = [...strokes, ...pendingStrokesRef.current];
    draw();
  }, [strokes, draw]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  const local = useCallback((e: PointerEvent, t0: number): StrokePoint => {
    let r = rectRef.current;
    if (!r && canvas.current) {
      r = canvas.current.getBoundingClientRect();
      rectRef.current = r;
    }
    const rLeft = r ? r.left : 0;
    const rTop = r ? r.top : 0;
    const currentW = widthRef.current || 1;
    const rWidth = r ? r.width : currentW;
    const scale = rWidth / currentW || 1;
    const pressure = e.pointerType === 'pen' || e.pointerType === 'touch' ? (e.pressure > 0 ? Math.max(0.15, e.pressure) : 0.5) : 0.5;
    return { x: (e.clientX - rLeft) / scale, y: (e.clientY - rTop) / scale, t: Math.round(e.timeStamp - t0), p: Number(pressure.toFixed(3)) };
  }, []);

  const eraseAt = useCallback((e: PointerEvent) => {
    const p = local(e, 0);
    for (const id of strokesHit(strokesRef.current, p.x, p.y)) erasing.current?.add(id);
    schedule();
  }, [local, schedule]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;

    const onDown = (e: PointerEvent) => {
      rectRef.current = c.getBoundingClientRect();
      if (e.pointerType === 'pen') markPenSeen();

      const { editable, tool, onActivate, onPenDown } = propsRef.current;
      const mode = useDevicePrefs.getState().inputMode;
      const fingerScroll = tool === 'view' || (e.pointerType === 'touch' && (mode === 'pen' || (mode === 'auto' && penSeen)));

      if (fingerScroll || !editable) {
        if (!editable && tool !== 'view') onActivate?.();
        scrolling.current = { id: e.pointerId, y: e.clientY, el: scrollParent(wrap.current) };
        return;
      }

      // Drawing with pen / stylus / touch: prevent default WebKit gestures immediately!
      e.preventDefault();
      onPenDown?.();

      if (tool === 'eraser') {
        erasing.current = new Set();
        eraseAt(e);
      } else {
        const strokeId = shortId('s');
        const p = local(e, e.timeStamp);
        activeStrokes.current.set(e.pointerId, { id: strokeId, points: [p], t0: e.timeStamp });
        schedule();
      }
    };

    const onMove = (e: PointerEvent) => {
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

      const l = activeStrokes.current.get(e.pointerId);
      if (!l) return;

      e.preventDefault();

      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = local(ev, l.t0);
        l.points.push(p);
        if (p.y > heightRef.current - GROW_MARGIN && heightRef.current < MAX_HEIGHT) {
          setHeight(Math.min(MAX_HEIGHT, p.y + GROW_MARGIN * 2));
        }
      }
      if (l.points.length > 20000) l.points.length = 20000;
      schedule();
    };

    const onUp = (e: PointerEvent) => {
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
          propsRef.current.onErase?.(ids);
        }
        draw();
        schedule();
        return;
      }

      const l = activeStrokes.current.get(e.pointerId);
      if (!l) return;
      activeStrokes.current.delete(e.pointerId);

      if (l.points.length > 0) {
        const stroke = { id: l.id, points: l.points };
        pendingStrokesRef.current.push(stroke);
        strokesRef.current = [...strokesRef.current, stroke];
        draw();
        propsRef.current.onStroke?.(stroke);
      }
      if (activeStrokes.current.size === 0) {
        rectRef.current = null;
      }
      schedule();
    };

    c.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });

    return () => {
      c.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [draw, eraseAt, local, schedule]);

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height, touchAction: 'none', WebkitUserSelect: 'none' }}>
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full select-none"
        style={{
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          cursor: editable ? (tool === 'eraser' ? 'cell' : tool === 'view' ? 'grab' : 'crosshair') : 'default',
        }}
        onDoubleClick={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
