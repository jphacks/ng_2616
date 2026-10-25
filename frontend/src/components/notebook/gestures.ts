'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Fingers currently on the screen (pens and mice are not counted). */
const touches = new Set<number>();
const pens = new Set<number>();
let activeInkDrawingCount = 0;
const onSecondFinger = new Set<() => void>();
let installed = false;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // capture on window runs before any element's handler, so a canvas already sees the new count
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'pen') pens.add(e.pointerId);
      if (e.pointerType !== 'touch') return;
      touches.add(e.pointerId);
      if (touches.size === 2) for (const cb of onSecondFinger) cb();
    },
    true,
  );
  const lift = (e: PointerEvent) => {
    if (e.pointerType === 'pen') pens.delete(e.pointerId);
    touches.delete(e.pointerId);
  };
  window.addEventListener('pointerup', lift, true);
  window.addEventListener('pointercancel', lift, true);
}

export function notifyInkDrawing(drawing: boolean) {
  if (drawing) activeInkDrawingCount++;
  else activeInkDrawingCount = Math.max(0, activeInkDrawingCount - 1);
}

export function isPenDown(): boolean {
  install();
  return pens.size > 0 || activeInkDrawingCount > 0;
}

export function fingersDown(): number {
  install();
  return touches.size;
}

/**
 * Runs `cb` when a second finger lands: single-finger work in progress (a finger stroke, a
 * finger scroll) must give way to a two-finger gesture.
 */
export function useSecondFinger(cb: () => void) {
  const latest = useRef(cb);
  useEffect(() => {
    latest.current = cb;
  });
  useEffect(() => {
    install();
    const run = () => latest.current();
    onSecondFinger.add(run);
    return () => {
      onSecondFinger.delete(run);
    };
  }, []);
}

// a tap is short and still; anything longer or wider is a scroll, pinch or hold
const TAP_MS = 350;
const TAP_SLOP = 14;

/**
 * Two- and three-finger taps on `ref` (tablet note-taking convention: two fingers undo, three
 * fingers redo). Fires once all fingers have lifted.
 */
export function useMultiFingerTap(ref: RefObject<HTMLElement | null>, handlers: { 2?: () => void; 3?: () => void }) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const starts = new Map<number, { x: number; y: number }>();
    let session: { t0: number; max: number; spoiled: boolean } | null = null;

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (starts.size === 0) session = { t0: e.timeStamp, max: 0, spoiled: false };
      starts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      session!.max = Math.max(session!.max, starts.size);
    };
    const move = (e: PointerEvent) => {
      const s = starts.get(e.pointerId);
      if (s && session && Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP) session.spoiled = true;
    };
    const up = (e: PointerEvent, cancelled: boolean) => {
      if (!starts.delete(e.pointerId) || !session) return;
      if (cancelled) session.spoiled = true;
      if (starts.size > 0) return;
      const { t0, max, spoiled } = session;
      session = null;
      if (spoiled || e.timeStamp - t0 > TAP_MS) return;
      if (max === 2) latest.current[2]?.();
      else if (max === 3) latest.current[3]?.();
    };
    const onUp = (e: PointerEvent) => up(e, false);
    const onCancel = (e: PointerEvent) => up(e, true);
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onCancel, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel, true);
    };
  }, [ref]);
}

const HOLD_DELAY = 450;
const REPEAT_START = 160;
const REPEAT_MIN = 60;

/**
 * Press-and-hold repeat for a button (holding Undo keeps undoing). A plain click still runs
 * once; after the hold starts repeating, the click that ends it is ignored.
 */
export function useHoldRepeat(action: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const latest = useRef({ action, enabled });
  useEffect(() => {
    latest.current = { action, enabled };
  });
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  // waits HOLD_DELAY, then repeats every REPEAT_START ms, speeding up like key repeat
  const tick = (delay: number) => {
    timer.current = setTimeout(() => {
      if (!latest.current.enabled) return stop();
      repeated.current = true;
      latest.current.action();
      tick(delay === HOLD_DELAY ? REPEAT_START : Math.max(REPEAT_MIN, delay * 0.9));
    }, delay);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      repeated.current = false;
      stop();
      tick(HOLD_DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => {
      if (repeated.current) {
        repeated.current = false;
        return;
      }
      action();
    },
  };
}

// long enough to reach for the next symbol, short enough to feel automatic
const AUTO_CONFIRM_MS = 1800;

/**
 * Confirms the active draft once its ink has rested for a moment (device setting, off by
 * default). `watch` reports the active draft's ink whenever it changes; any new pen or finger
 * contact restarts the wait, so a slow stroke is never cut off.
 */
export function useAutoConfirm(
  enabled: boolean,
  watch: (onInk: (lineId: string, ink: readonly unknown[]) => void) => () => void,
  confirm: (lineId: string) => void,
) {
  const latest = useRef(confirm);
  useEffect(() => {
    latest.current = confirm;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: { lineId: string; ink: readonly unknown[] } | null = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const arm = () => {
      clear();
      if (!last || last.ink.length === 0) return;
      const target = last;
      timer = setTimeout(() => {
        if (last === target) latest.current(target.lineId);
      }, AUTO_CONFIRM_MS);
    };
    const stop = watch((lineId, ink) => {
      last = { lineId, ink };
      arm();
    });
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') clear();
    };
    // a touch that did not change the ink (a scroll, a tap) lets the wait resume
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') arm();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      clear();
      stop();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
    };
  }, [enabled, watch]);
}
