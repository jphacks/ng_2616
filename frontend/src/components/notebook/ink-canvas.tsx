'use client';

import type { Stroke, StrokePoint } from '@mn/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { scratchTargets } from '@/core/ink/scratch';
import { drawStroke, strokesHit } from '@/core/ink/stroke';
import { INK_WEIGHTS, useDevicePrefs } from '@/core/prefs/device';
import { tokenColor } from '@/ui/tokens';
import type { Tool } from '@/core/store/notebook-store';
import { fingersDown, isPenDown, notifyInkDrawing, useSecondFinger } from './gestures';
import { usePageZoom } from './zoom';

import { inkHeight, LINE_HEIGHT, MAX_HEIGHT, PADDING_BOTTOM } from '@/core/ink/height';
export { inkHeight, LINE_HEIGHT };
const ERASER_RADIUS = 20;
const MAX_BACKING_SCALE = 3;
const INK_ALPHA = { erasing: 0.18, dim: 0.55, hover: 0.32 } as const;

let penSeen = false;
const markPenSeen = () => {
  penSeen = true;
};

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
  pointerId: number;
  touch: boolean;
  points: StrokePoint[];
  t0: number;
}

export function InkCanvas({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown, onScratchOut }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backingCanvas = useRef<HTMLCanvasElement | null>(null);
  const backingDirty = useRef(true);

  // Active stroke currently being drawn
  const activeStrokes = useRef<Map<number, LiveStroke>>(new Map());
  const erasingPointer = useRef<number | null>(null);
  const erasingByTouch = useRef(false);
  const erasing = useRef<Set<string> | null>(null);
  const scrolling = useRef<{ id: number; y: number; el: HTMLElement | null } | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const scheduled = useRef(false);

  const inkSize = INK_WEIGHTS[useDevicePrefs((s) => s.inkWeight)];
  const zoom = usePageZoom((s) => s.settled);

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

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setWidth(Math.floor(e!.contentRect.width));
      rectRef.current = null;
      backingDirty.current = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateBacking = useCallback((w: number, h: number, dpr: number) => {
    if (!backingCanvas.current) {
      backingCanvas.current = document.createElement('canvas');
    }
    const bc = backingCanvas.current;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (bc.width !== bw || bc.height !== bh) {
      bc.width = bw;
      bc.height = bh;
    }
    const bctx = bc.getContext('2d')!;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);

    const hidden = erasing.current;
    const list = strokesRef.current;
    const ink = tokenColor('--color-ink');
    bctx.fillStyle = ink;
    bctx.strokeStyle = ink;
    for (const s of list) {
      bctx.globalAlpha = hidden?.has(s.id) ? INK_ALPHA.erasing : dim ? INK_ALPHA.dim : 1;
      drawStroke(bctx, s.points, inkSize, true);
    }
    backingDirty.current = false;
  }, [dim, inkSize]);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c || width === 0) return;
    const dpr = Math.min(MAX_BACKING_SCALE, (window.devicePixelRatio || 1) * zoom);
    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
      backingDirty.current = true;
    }

    if (backingDirty.current) {
      updateBacking(width, height, dpr);
    }

    const ctx = c.getContext('2d', { desynchronized: true })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);

    // 1. Draw cached finished strokes in a single GPU blit (0.05ms)
    if (backingCanvas.current) {
      ctx.drawImage(backingCanvas.current, 0, 0);
    }

    // 2. Draw live stroke
    for (const l of activeStrokes.current.values()) {
      if (!l.points.length) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ink = tokenColor('--color-ink');
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 1;
      drawStroke(ctx, l.points, inkSize, false);
    }

    // 3. Hover preview
    const h = hover.current;
    if (h && editable && !activeStrokes.current.size && !erasing.current) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  }, [width, height, inkSize, editable, tool, zoom, updateBacking]);

  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  });

  // repaint when the size, zoom, weight or dimming changes: a canvas that is only shown (a failed
  // line, a line being read) gets its width after mount and has no input to trigger a repaint
  useLayoutEffect(() => {
    backingDirty.current = true;
    draw();
  }, [draw]);

  useLayoutEffect(() => {
    if (strokes.length === 0 && activeStrokes.current.size === 0) {
      pendingStrokesRef.current = [];
      strokesRef.current = [];
    } else {
      const confirmed = new Set(strokes.map((s) => s.id));
      if (pendingStrokesRef.current.length > 0) {
        pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !confirmed.has(s.id));
      }
      if (strokes.length < strokesRef.current.length) {
        pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => confirmed.has(s.id));
      }
      const map = new Map<string, Stroke>();
      for (const s of strokes) map.set(s.id, s);
      for (const s of pendingStrokesRef.current) {
        if (!map.has(s.id)) map.set(s.id, s);
      }
      strokesRef.current = Array.from(map.values());
    }
    backingDirty.current = true;
    if (activeStrokes.current.size === 0) {
      setHeight(inkHeight(strokesRef.current));
    }
    drawRef.current();
  }, [strokes]);

  const schedule = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    requestAnimationFrame(() => {
      scheduled.current = false;
      drawRef.current();
    });
  }, []);

  useSecondFinger(() => {
    for (const [id, stroke] of activeStrokes.current) {
      if (stroke.touch) {
        activeStrokes.current.delete(id);
        notifyInkDrawing(false);
      }
    }
    if (erasingByTouch.current) { erasing.current = null; erasingPointer.current = null; }
    backingDirty.current = true;
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

  const commitLive = useCallback((pointerId: number) => {
    const l = activeStrokes.current.get(pointerId);
    if (!l) return;
    activeStrokes.current.delete(pointerId);
    notifyInkDrawing(false);

    if (l.points.length === 0) return;

    // Check dynamic row expansion on pen-up instead of inside high-frequency onMove
    const maxY = l.points.reduce((max, p) => (p.y > max ? p.y : max), 0);
    const needed = Math.ceil(maxY + PADDING_BOTTOM);
    if (needed > heightRef.current && heightRef.current < MAX_HEIGHT) {
      setHeight(Math.min(MAX_HEIGHT, Math.max(LINE_HEIGHT, needed)));
    }

    const duration = l.points.length > 1 ? l.points[l.points.length - 1]!.t - l.points[0]!.t : 0;
    // Fast writing (< 250ms) should never be treated as scratch-out gesture
    const scratched = duration >= 250 && useDevicePrefs.getState().scratchToErase && propsRef.current.onScratchOut
      ? scratchTargets(l.points, strokesRef.current)
      : null;

    if (scratched) {
      const drop = new Set(scratched);
      pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !drop.has(s.id));
      strokesRef.current = strokesRef.current.filter((s) => !drop.has(s.id));
      backingDirty.current = true;
      setHeight(inkHeight(strokesRef.current));
      drawRef.current();
      propsRef.current.onScratchOut?.(scratched);
    } else {
      const stroke = { id: l.id, points: l.points };
      pendingStrokesRef.current.push(stroke);
      if (!strokesRef.current.some((s) => s.id === stroke.id)) {
        strokesRef.current = [...strokesRef.current, stroke];
      }
      backingDirty.current = true;
      drawRef.current();
      propsRef.current.onStroke?.(stroke);
    }
    rectRef.current = null;
    schedule();
  }, [schedule]);

  const commitLiveRef = useRef(commitLive);
  useLayoutEffect(() => {
    commitLiveRef.current = commitLive;
  });

  const eraseAt = useCallback((e: PointerEvent) => {
    const p = local(e, 0);
    for (const id of strokesHit(strokesRef.current, p.x, p.y, ERASER_RADIUS)) erasing.current?.add(id);
    backingDirty.current = true;
    schedule();
  }, [local, schedule]);

  // Mount native listeners ONCE. Never unbind/rebind on state or props changes!
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const strokesInFlight = activeStrokes.current;

    const commitEraser = () => {
      if (!erasing.current) return;
      const ids = [...erasing.current];
      erasing.current = null;
      erasingPointer.current = null;
      if (ids.length) {
        const drop = new Set(ids);
        pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !drop.has(s.id));
        strokesRef.current = strokesRef.current.filter((s) => !drop.has(s.id));
        backingDirty.current = true;
        setHeight(inkHeight(strokesRef.current));
        propsRef.current.onErase?.(ids);
      }
      drawRef.current();
      schedule();
    };

    const startStroke = (e: PointerEvent) => {
      // 1. SALVAGE: If rapid strokes occur and the previous stroke was not yet committed, commit it immediately!
      if (activeStrokes.current.has(e.pointerId)) commitLiveRef.current(e.pointerId);

      rectRef.current = c.getBoundingClientRect();
      const { editable, tool, onPenDown } = propsRef.current;
      if (!editable || tool === 'view') return;

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
        activeStrokes.current.set(e.pointerId, { id: strokeId, pointerId: e.pointerId, touch: e.pointerType === 'touch', points: [p], t0: e.timeStamp });
        notifyInkDrawing(true);
        schedule();
      }
    };

    const onDown = (e: PointerEvent) => {
      const isPen = e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5);
      if (isPen) markPenSeen();
      // a second finger is a gesture (undo tap, pinch), never a stroke, whatever pressure it reports
      if (e.pointerType === 'touch' && fingersDown() > 1) return;
      // its pointerdown can also arrive before fingersDown() counts it: then drop what the first
      // finger started instead of salvaging it as a stroke
      if (e.pointerType === 'touch' && [...activeStrokes.current.values()].some(l => l.touch && l.pointerId !== e.pointerId)) {
        for (const [id, stroke] of activeStrokes.current) if (stroke.touch) activeStrokes.current.delete(id);
        schedule();
        return;
      }

      const { editable, tool, onActivate } = propsRef.current;
      const mode = useDevicePrefs.getState().inputMode;
      // Eraser tool works with both stylus and finger touch!
      const fingerScroll = tool === 'view' || (tool !== 'eraser' && e.pointerType === 'touch' && !isPen && (mode === 'pen' || (mode === 'auto' && penSeen)));

      if (fingerScroll) {
        scrolling.current = { id: e.pointerId, y: e.clientY, el: scrollParent(wrap.current) };
        return;
      }

      if (!editable) {
        if (isPenDown()) return;
        onActivate?.();
        e.preventDefault();
        startStroke(e);
        return;
      }

      e.preventDefault();
      startStroke(e);
    };

    const onMove = (e: PointerEvent) => {
      const isContact = (e.buttons & 1) === 1 || (e.pointerType === 'pen' && (e.pressure > 0 || e.buttons > 0));

      // Pen is hovering above the screen without contact
      if (e.pointerType === 'pen' && !isContact) {
        if (activeStrokes.current.has(e.pointerId)) commitLiveRef.current(e.pointerId);
        if (erasing.current) commitEraser();
        hover.current = e.target === c ? local(e, 0) : null;
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

      // Auto-start stroke if pointerdown was swallowed by iPadOS / Scribble
      if (!activeStrokes.current.has(e.pointerId) && e.target === c && e.pointerType === 'pen' && isContact && propsRef.current.editable && propsRef.current.tool === 'pen') {
        startStroke(e);
      }

      const l = activeStrokes.current.get(e.pointerId);
      if (!l) return;

      // Contact lost mid-move without pointerup event
      if (!isContact && e.pointerType === 'pen') {
        commitLiveRef.current(e.pointerId);
        return;
      }

      e.preventDefault();

      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const p = local(ev, l.t0);
        l.points.push(p);
      }
      if (l.points.length > 20000) l.points.length = 20000;
      schedule();
    };

    const onUp = (e: PointerEvent) => {
      if (scrolling.current?.id === e.pointerId) {
        scrolling.current = null;
        return;
      }

      if (erasing.current && (erasingPointer.current === null || erasingPointer.current === e.pointerId)) {
        commitEraser();
        return;
      }

      const l = activeStrokes.current.get(e.pointerId);
      if (!l) return;

      // A delayed pointerup from another stroke must not finish the current pointer.
      commitLiveRef.current(e.pointerId);
    };

    // Prevent Safari/iPadOS from intercepting touches for Scribble or native gestures
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length <= 1 && propsRef.current.editable && propsRef.current.tool !== 'view') {
        if (e.cancelable) e.preventDefault();
      }
    };

    c.addEventListener('touchstart', onTouch, { passive: false });
    c.addEventListener('touchmove', onTouch, { passive: false });
    c.addEventListener('touchend', onTouch, { passive: false });
    c.addEventListener('touchcancel', onTouch, { passive: false });

    c.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });

    return () => {
      for (const pointerId of [...strokesInFlight.keys()]) commitLiveRef.current(pointerId);
      commitEraser();
      c.removeEventListener('touchstart', onTouch);
      c.removeEventListener('touchmove', onTouch);
      c.removeEventListener('touchend', onTouch);
      c.removeEventListener('touchcancel', onTouch);
      c.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [eraseAt, local, schedule]);

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
        onPointerLeave={() => {
          if (!hover.current) return;
          hover.current = null;
          schedule();
        }}
      />
    </div>
  );
}
