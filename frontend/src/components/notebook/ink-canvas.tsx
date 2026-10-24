'use client';

import type { Stroke, StrokePoint } from '@mn/contracts';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { scratchTargets } from '@/core/ink/scratch';
import { drawStroke, strokesBounds, strokesHit } from '@/core/ink/stroke';
import { INK_WEIGHTS, useDevicePrefs } from '@/core/prefs/device';
import { tokenColor } from '@/ui/tokens';
import type { Tool } from '@/core/store/notebook-store';
import { fingersDown, useSecondFinger } from './gestures';
import { usePageZoom } from './zoom';

export const LINE_HEIGHT = 140;
const MAX_HEIGHT = 560;
const GROW_MARGIN = 36;
const ERASER_RADIUS = 12;
const MAX_BACKING_SCALE = 3;
const INK_ALPHA = { erasing: 0.18, dim: 0.55, hover: 0.32 } as const;

let penSeen = false;
const markPenSeen = () => {
  penSeen = true;
};

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
  pointerId: number;
  points: StrokePoint[];
  t0: number;
}

export function InkCanvas({ strokes, editable, tool, dim, onStroke, onErase, onActivate, onPenDown, onScratchOut }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backingCanvas = useRef<HTMLCanvasElement | null>(null);
  const backingDirty = useRef(true);

  // Active stroke currently being drawn
  const liveStroke = useRef<LiveStroke | null>(null);
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
    backingDirty.current = true;
    setHeight((h) => Math.max(inkHeight(strokes), liveStroke.current ? h : 0));
  }, [strokes]);

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

    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);

    // 1. Draw cached finished strokes in a single GPU blit (0.05ms)
    if (backingCanvas.current) {
      ctx.drawImage(backingCanvas.current, 0, 0);
    }

    // 2. Draw live stroke
    const l = liveStroke.current;
    if (l && l.points.length > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ink = tokenColor('--color-ink');
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 1;
      drawStroke(ctx, l.points, inkSize, false);
    }

    // 3. Hover preview
    const h = hover.current;
    if (h && editable && !liveStroke.current && !erasing.current) {
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

  useLayoutEffect(() => {
    if (strokes.length === 0 && !liveStroke.current) {
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
    drawRef.current();
  }, [strokes]);

  useLayoutEffect(() => {
    if (width > 0) {
      backingDirty.current = true;
      drawRef.current();
    }
  }, [width, height]);

  const schedule = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    requestAnimationFrame(() => {
      scheduled.current = false;
      drawRef.current();
    });
  }, []);

  useSecondFinger(() => {
    liveStroke.current = null;
    erasing.current = null;
    scrolling.current = null;
    schedule();
  });

  const local = (e: PointerEvent, t0: number): StrokePoint => {
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
  };

  const commitLive = useCallback(() => {
    const l = liveStroke.current;
    if (!l) return;
    liveStroke.current = null;

    if (l.points.length === 0) return;

    // Check dynamic row expansion on pen-up instead of inside high-frequency onMove
    const maxY = l.points.reduce((max, p) => (p.y > max ? p.y : max), 0);
    if (maxY > heightRef.current - GROW_MARGIN && heightRef.current < MAX_HEIGHT) {
      setHeight(Math.min(MAX_HEIGHT, maxY + GROW_MARGIN * 2));
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

  const eraseAt = (e: PointerEvent) => {
    const p = local(e, 0);
    for (const id of strokesHit(strokesRef.current, p.x, p.y, ERASER_RADIUS)) erasing.current?.add(id);
    backingDirty.current = true;
    schedule();
  };

  const eraseAtRef = useRef(eraseAt);
  useLayoutEffect(() => {
    eraseAtRef.current = eraseAt;
  });

  // Mount native listeners ONCE. Never unbind/rebind on state or props changes!
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;

    const startStroke = (e: PointerEvent) => {
      // 1. SALVAGE: If rapid strokes occur and the previous stroke was not yet committed, commit it immediately!
      if (liveStroke.current && liveStroke.current.points.length > 0) {
        commitLiveRef.current();
      }

      if (!rectRef.current) rectRef.current = c.getBoundingClientRect();
      const { editable, tool, onPenDown } = propsRef.current;
      if (!editable || tool === 'view') return;

      hover.current = null;
      onPenDown?.();

      if (tool === 'eraser') {
        erasing.current = new Set();
        eraseAtRef.current(e);
      } else {
        const strokeId = shortId('s');
        const p = local(e, e.timeStamp);
        liveStroke.current = { id: strokeId, pointerId: e.pointerId, points: [p], t0: e.timeStamp };
        schedule();
      }
    };

    const onDown = (e: PointerEvent) => {
      const isPen = e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5);
      if (isPen) markPenSeen();
      if (e.pointerType === 'touch' && !isPen && fingersDown() > 1) return;

      const { editable, tool, onActivate } = propsRef.current;
      const mode = useDevicePrefs.getState().inputMode;
      const fingerScroll = tool === 'view' || (!isPen && (mode === 'pen' || (mode === 'auto' && penSeen)));

      if (fingerScroll || !editable) {
        if (!editable && tool !== 'view') onActivate?.();
        scrolling.current = { id: e.pointerId, y: e.clientY, el: scrollParent(wrap.current) };
        return;
      }

      e.preventDefault();
      startStroke(e);
    };

    const onMove = (e: PointerEvent) => {
      const isContact = (e.buttons & 1) === 1 || (e.pointerType === 'pen' && (e.pressure > 0 || e.buttons > 0));

      // Pen is hovering above the screen without contact
      if (e.pointerType === 'pen' && !isContact) {
        if (liveStroke.current) {
          commitLiveRef.current();
        }
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
        eraseAtRef.current(e);
        return;
      }

      // Auto-start stroke if pointerdown was swallowed by iPadOS / Scribble
      if (!liveStroke.current && isContact && propsRef.current.editable && propsRef.current.tool === 'pen') {
        startStroke(e);
      }

      const l = liveStroke.current;
      if (!l) return;

      // Contact lost mid-move without pointerup event
      if (!isContact && e.pointerType === 'pen') {
        commitLiveRef.current();
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

      if (erasing.current) {
        const ids = [...erasing.current];
        erasing.current = null;
        if (ids.length) {
          const drop = new Set(ids);
          pendingStrokesRef.current = pendingStrokesRef.current.filter((s) => !drop.has(s.id));
          strokesRef.current = strokesRef.current.filter((s) => !drop.has(s.id));
          backingDirty.current = true;
          propsRef.current.onErase?.(ids);
        }
        drawRef.current();
        schedule();
        return;
      }

      const l = liveStroke.current;
      if (!l) return;

      // Commit if this pointer matches or if the timestamp is newer than stroke start
      if (e.timeStamp >= l.t0 || l.pointerId === e.pointerId) {
        commitLiveRef.current();
      }
    };

    // Prevent Safari/iPadOS from intercepting single-finger touches for scrolling or Scribble
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length <= 1 && propsRef.current.editable && propsRef.current.tool !== 'view') {
        if (e.cancelable) e.preventDefault();
      }
    };

    c.addEventListener('touchstart', onTouch, { passive: false });
    c.addEventListener('touchmove', onTouch, { passive: false });

    c.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });

    return () => {
      if (liveStroke.current) {
        commitLiveRef.current();
      }
      c.removeEventListener('touchstart', onTouch);
      c.removeEventListener('touchmove', onTouch);
      c.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [schedule]);

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
