'use client';

import type { Stroke, StrokePoint } from '@mn/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { scratchTargets } from '@/core/ink/scratch';
import { drawStroke, strokesBounds, strokesHit } from '@/core/ink/stroke';
import { INK_WEIGHTS, useDevicePrefs } from '@/core/prefs/device';
import type { Tool } from '@/core/store/notebook-store';
import { tokenColor } from '@/ui/tokens';
import { fingersDown, useSecondFinger } from './gestures';
import { usePageZoom } from './zoom';

export const LINE_HEIGHT = 140;
const MAX_HEIGHT = 560;
const GROW_MARGIN = 36;
const ERASER_RADIUS = 12;
const MAX_BACKING_SCALE = 3;
const INK_ALPHA = { erasing: 0.18, dim: 0.55, hover: 0.32 } as const;

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
  onScratchOut?: (ids: string[]) => void;
}

interface LiveStroke {
  id: string;
  points: StrokePoint[];
  t0: number;
  touch: boolean;
}

/**
 * Line-local ink surface. Pointer Events with capture, coalesced events and pressure;
 * logical CSS-pixel coordinates (spec §8.1). Buttons live outside the canvas.
 */
export function InkCanvas({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown, onScratchOut }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const activeStrokes = useRef<Map<number, LiveStroke>>(new Map());
  const erasing = useRef<Set<string> | null>(null);
  const erasingPointer = useRef<number | null>(null);
  const erasingByTouch = useRef(false);
  const scrolling = useRef<{ id: number; y: number; el: HTMLElement | null } | null>(null);
  const frame = useRef(0);
  const rectRef = useRef<DOMRect | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const inkSize = INK_WEIGHTS[useDevicePrefs((s) => s.inkWeight)];
  const zoom = usePageZoom((s) => s.settled);
  // every draw reads the latest strokes from strokesRef.
  // pendingStrokesRef holds optimistically added strokes that React has not yet passed down in props.strokes.
  // This prevents fast consecutive strokes from being wiped out by an in-flight React re-render.
  const strokesRef = useRef(strokes);
  const pendingStrokesRef = useRef<Stroke[]>([]);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(() => inkHeight(strokes));

  const propsRef = useRef({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown, onScratchOut });
  const widthRef = useRef(width);
  const heightRef = useRef(height);

  useLayoutEffect(() => {
    propsRef.current = { strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown, onScratchOut };
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
    const dpr = Math.min(MAX_BACKING_SCALE, (window.devicePixelRatio || 1) * zoom);
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const hidden = erasing.current;
    const list = strokesRef.current;
    const ink = tokenColor('--color-ink');
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    for (const s of list) {
      ctx.globalAlpha = hidden?.has(s.id) ? INK_ALPHA.erasing : dim ? INK_ALPHA.dim : 1;
      drawStroke(ctx, s.points, inkSize, true);
    }
    ctx.globalAlpha = 1;
    for (const live of activeStrokes.current.values()) {
      drawStroke(ctx, live.points, inkSize, false);
    }
    const h = hover.current;
    if (h && editable && !activeStrokes.current.size && !hidden) {
      ctx.beginPath();
      ctx.globalAlpha = INK_ALPHA.hover;
      if (tool === 'eraser') {
        ctx.lineWidth = 1;
        ctx.arc(h.x, h.y, ERASER_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tool === 'pen') {
        ctx.arc(h.x, h.y, inkSize / 2 + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }, [width, height, dim, inkSize, editable, tool, zoom]);

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

  // A second finger starts a gesture; discard finger ink while retaining any pen stroke.
  useSecondFinger(() => {
    for (const [id, stroke] of activeStrokes.current) if (stroke.touch) activeStrokes.current.delete(id);
    if (erasingByTouch.current) { erasing.current = null; erasingPointer.current = null; }
    scrolling.current = null;
    rectRef.current = null;
    schedule();
  });

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
    for (const id of strokesHit(strokesRef.current, p.x, p.y, ERASER_RADIUS)) erasing.current?.add(id);
    schedule();
  }, [local, schedule]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;

    const onDown = (e: PointerEvent) => {
      rectRef.current = c.getBoundingClientRect();
      if (e.pointerType === 'pen') markPenSeen();
      if (e.pointerType === 'touch' && fingersDown() > 1) return;

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
      hover.current = null;
      onPenDown?.();

      if (tool === 'eraser') {
        erasing.current = new Set();
        erasingPointer.current = e.pointerId;
        erasingByTouch.current = e.pointerType === 'touch';
        eraseAt(e);
      } else {
        const strokeId = shortId('s');
        const p = local(e, e.timeStamp);
        activeStrokes.current.set(e.pointerId, { id: strokeId, points: [p], t0: e.timeStamp, touch: e.pointerType === 'touch' });
        schedule();
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && e.buttons === 0 && !activeStrokes.current.has(e.pointerId) && erasingPointer.current !== e.pointerId) {
        if (e.target === c) { rectRef.current = null; hover.current = local(e, 0); }
        else hover.current = null;
        schedule();
        return;
      }
      const sc = scrolling.current;
      if (sc && sc.id === e.pointerId) {
        if (sc.el) sc.el.scrollTop -= e.clientY - sc.y;
        sc.y = e.clientY;
        return;
      }

      if (erasing.current && erasingPointer.current === e.pointerId) {
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

      if (erasing.current && erasingPointer.current === e.pointerId) {
        const ids = [...erasing.current];
        erasing.current = null;
        erasingPointer.current = null;
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

      const scratchOut = propsRef.current.onScratchOut;
      const scratched = useDevicePrefs.getState().scratchToErase && scratchOut ? scratchTargets(l.points, strokesRef.current) : null;
      if (scratched) {
        const drop = new Set(scratched);
        pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !drop.has(s.id));
        strokesRef.current = strokesRef.current.filter((s) => !drop.has(s.id));
        draw();
        scratchOut!(scratched);
      } else if (l.points.length > 0) {
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

    const onLeave = () => { if (hover.current) { hover.current = null; schedule(); } };

    c.addEventListener('pointerdown', onDown, { passive: false });
    c.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });

    return () => {
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointerleave', onLeave);
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
