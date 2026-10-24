'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

// how far the finger must pull (after damping) before releasing refreshes
export const PULL_THRESHOLD = 64;
const MAX_PULL = 96;
const DAMPING = 0.5;
// a pull starts with movement; a finger that rests first is holding a card instead
const MAX_START_DELAY = 300;

/**
 * Pull down at the top of `ref` to refresh. Uses touch events, which keep arriving while the
 * browser pans (pointer events are cancelled once a pan starts).
 */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { y: number; t: number } | null = null;
    let distance = 0;
    let busy = false;

    const begin = (e: TouchEvent) => {
      start = e.touches.length === 1 && el.scrollTop <= 0 && !busy ? { y: e.touches[0]!.clientY, t: e.timeStamp } : null;
      distance = 0;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const dy = e.touches[0]!.clientY - start.y;
      if (distance === 0 && (dy <= 0 || e.timeStamp - start.t > MAX_START_DELAY || el.scrollTop > 0)) {
        if (Math.abs(dy) > 4) start = null;
        return;
      }
      distance = Math.min(MAX_PULL, Math.max(0, dy * DAMPING));
      setPull(distance);
    };
    const end = () => {
      if (!start) return;
      start = null;
      if (distance >= PULL_THRESHOLD) {
        busy = true;
        setRefreshing(true);
        void latest.current().finally(() => {
          busy = false;
          setRefreshing(false);
          setPull(0);
        });
      } else setPull(0);
      distance = 0;
    };
    el.addEventListener('touchstart', begin, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', begin);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref]);

  return { pull, refreshing };
}
