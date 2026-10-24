'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Page zoom. `zoom` follows the fingers; `settled` changes only when a pinch ends, so ink
 * canvases re-render at the sharper resolution once instead of on every frame.
 */
export const usePageZoom = create<{ zoom: number; settled: number; set: (zoom: number, settled?: boolean) => void }>((set) => ({
  zoom: 1,
  settled: 1,
  set: (zoom, settled = true) => set(settled ? { zoom, settled: zoom } : { zoom }),
}));

/**
 * Two-finger pinch (and trackpad pinch) zooms the page around the fingers; moving both
 * fingers pans. The page is laid out at its normal width and scaled, so ink coordinates and
 * line layout never change with zoom.
 */
export function usePinchZoom(scroller: RefObject<HTMLDivElement | null>, content: RefObject<HTMLDivElement | null>) {
  const zoom = usePageZoom((s) => s.zoom);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // the content point to keep under the fingers, applied once the new size is laid out
  const anchor = useRef<{ x: number; y: number; atX: number; atY: number } | null>(null);

  // zoom starts at 100% on every visit
  useEffect(() => () => usePageZoom.getState().set(1), []);

  useEffect(() => {
    const sc = scroller.current;
    const el = content.current;
    if (!sc || !el) return;
    const ro = new ResizeObserver(() => setSize({ width: sc.clientWidth, height: el.offsetHeight }));
    ro.observe(sc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroller, content]);

  useLayoutEffect(() => {
    const sc = scroller.current;
    const a = anchor.current;
    if (!sc || !a) return;
    anchor.current = null;
    sc.scrollTo(a.x * zoom - a.atX, a.y * zoom - a.atY);
  }, [zoom, scroller]);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; zoom: number } | null = null;

    // keeps the content under (clientX, clientY) there after the next zoom change
    const holdPoint = (clientX: number, clientY: number) => {
      const box = sc.getBoundingClientRect();
      const atX = clientX - box.left;
      const atY = clientY - box.top;
      const current = usePageZoom.getState().zoom;
      anchor.current = { x: (sc.scrollLeft + atX) / current, y: (sc.scrollTop + atY) / current, atX, atY };
    };

    const geometry = () => {
      const [a, b] = [...fingers.values()];
      return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) pinch = { dist: geometry().dist, zoom: usePageZoom.getState().zoom };
      else pinch = null;
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch || fingers.size !== 2) return;
      const g = geometry();
      const next = clamp(pinch.zoom * (g.dist / pinch.dist));
      holdPoint(g.x, g.y);
      usePageZoom.getState().set(next, false);
    };
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      if (pinch && fingers.size < 2) {
        pinch = null;
        const z = usePageZoom.getState().zoom;
        // close to 100% snaps back to it
        usePageZoom.getState().set(z < 1.08 ? 1 : z);
      }
    };
    // trackpads report a pinch as ctrl + wheel
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const current = usePageZoom.getState().zoom;
      const next = clamp(current * Math.exp(-e.deltaY / 200));
      holdPoint(e.clientX, e.clientY);
      usePageZoom.getState().set(next);
    };
    sc.addEventListener('pointerdown', down, true);
    sc.addEventListener('pointermove', move, true);
    sc.addEventListener('pointerup', up, true);
    sc.addEventListener('pointercancel', up, true);
    sc.addEventListener('wheel', wheel, { passive: false });
    return () => {
      sc.removeEventListener('pointerdown', down, true);
      sc.removeEventListener('pointermove', move, true);
      sc.removeEventListener('pointerup', up, true);
      sc.removeEventListener('pointercancel', up, true);
      sc.removeEventListener('wheel', wheel);
    };
  }, [scroller]);

  return { zoom, size };
}

/** Reset to 100%, keeping the top-left of the view in place. */
export function resetZoom(scroller: HTMLElement | null) {
  const { zoom, set } = usePageZoom.getState();
  if (scroller) {
    const top = scroller.scrollTop / zoom;
    set(1);
    requestAnimationFrame(() => scroller.scrollTo(0, top));
  } else set(1);
}
