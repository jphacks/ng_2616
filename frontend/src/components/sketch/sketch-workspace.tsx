'use client';
/* eslint-disable no-restricted-syntax -- the sketch page is plain white paper in every theme, like the picture the model returns */

import type { Notebook, Stroke, StrokePoint } from '@mn/contracts';
import clsx from 'clsx';
import { ArrowLeft, Eraser, PenLine, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortId } from '@/core/ids';
import { drawStroke } from '@/core/ink/stroke';
import { getRepository } from '@/core/persistence/repo';
import { useT } from '@/i18n';
import { Spinner } from '@/ui/spinner';

// the pause after the last stroke that asks for a completion
const PAUSE_MS = 2000;
const SAVE_MS = 1000;
const INK = '#111111';
const INK_SIZE = 3.4;
const ERASER_RADIUS = 16;
// the longest side of the picture sent to the model
const SHOT_MAX = 1024;

export const isSketch = (nb: Notebook) => (nb.extensions as { kind?: unknown } | undefined)?.kind === 'sketch';

const strokesOf = (nb: Notebook): Stroke[] => ((nb.extensions as { sketch?: { strokes?: Stroke[] } }).sketch?.strokes ?? []);

function paint(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], w: number, h: number, scale: number) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = INK;
  for (const s of strokes) drawStroke(ctx, s.points, INK_SIZE);
}

/** The whole page on white, as base64 PNG. */
function screenshot(strokes: readonly Stroke[], w: number, h: number): string {
  const scale = Math.min(1, SHOT_MAX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  paint(c.getContext('2d')!, strokes, w, h, scale);
  return c.toDataURL('image/png').split(',')[1]!;
}

const hits = (s: Stroke, x: number, y: number) => s.points.some((p) => Math.hypot(p.x - x, p.y - y) < ERASER_RADIUS);

/**
 * An ink-only notebook: no recognition, no checking. Each pause hands a picture of the page to an
 * image model, which answers with the page completed in the writer's own hand.
 */
export function SketchWorkspace({ userId, notebook, revision }: { userId: string; notebook: Notebook; revision: number | null }) {
  const t = useT();
  const [strokes, setStrokes] = useState<Stroke[]>(() => strokesOf(notebook));
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [image, setImage] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ pointerId: number; points: StrokePoint[]; t0: number } | null>(null);
  const strokesRef = useRef(strokes);
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inflight = useRef<AbortController | null>(null);
  const rev = useRef(revision);
  const dirty = useRef(false);

  // --- drawing ---

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr)) c.width = Math.round(size.w * dpr);
    if (c.height !== Math.round(size.h * dpr)) c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    paint(ctx, strokesRef.current, size.w, size.h, dpr);
    if (live.current) drawStroke(ctx, live.current.points, INK_SIZE, false);
  }, [size]);

  useEffect(redraw, [redraw, strokes]);

  // --- completion ---

  const cancel = () => {
    clearTimeout(pauseTimer.current);
    inflight.current?.abort();
    inflight.current = null;
    setThinking(false);
  };

  const complete = useCallback(async () => {
    const page = strokesRef.current;
    if (page.length === 0 || !size.w) {
      setImage(null);
      return;
    }
    const ctl = new AbortController();
    inflight.current = ctl;
    setThinking(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/sketch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: screenshot(page, size.w, size.h), width: size.w, height: size.h }),
        signal: ctl.signal,
        cache: 'no-store',
      });
      const body = (await res.json()) as { ok: boolean; data?: { image: string; mime: string }; error?: { message: string } };
      if (ctl.signal.aborted) return;
      if (!body.ok || !body.data) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setImage(`data:${body.data.mime};base64,${body.data.image}`);
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inflight.current === ctl) {
        inflight.current = null;
        setThinking(false);
      }
    }
  }, [size]);

  const changed = (next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    dirty.current = true;
    cancel();
    pauseTimer.current = setTimeout(() => void complete(), PAUSE_MS);
  };

  // a page opened with ink on it gets its completion right away
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !size.w) return;
    opened.current = true;
    if (strokesRef.current.length) void complete();
  }, [size, complete]);

  useEffect(() => () => cancel(), []);

  // --- saving ---

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(async () => {
      dirty.current = false;
      const nb: Notebook = { ...notebook, extensions: { ...notebook.extensions, kind: 'sketch', sketch: { strokes: strokesRef.current } } };
      const res = await getRepository(userId).save(nb, rev.current);
      if (res.ok) rev.current = res.revision;
      else setError(res.message ?? res.reason);
    }, SAVE_MS);
    return () => clearTimeout(timer);
  }, [strokes, notebook, userId]);

  // --- pointer ---

  const at = (e: React.PointerEvent): StrokePoint => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: 0, p: e.pressure || 0.5 };
  };

  const erase = (p: StrokePoint) => {
    const next = strokesRef.current.filter((s) => !hits(s, p.x, p.y));
    if (next.length !== strokesRef.current.length) changed(next);
  };

  const onDown = (e: React.PointerEvent) => {
    if (live.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // writing again means the pending completion is out of date
    cancel();
    const p = at(e);
    if (tool === 'eraser' || e.button === 5) {
      live.current = { pointerId: e.pointerId, points: [], t0: -1 };
      erase(p);
      return;
    }
    live.current = { pointerId: e.pointerId, points: [p], t0: performance.now() };
    redraw();
  };

  const onMove = (e: React.PointerEvent) => {
    const s = live.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (s.t0 < 0) {
      erase(at(e));
      return;
    }
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const r = canvas.current!.getBoundingClientRect();
    for (const ev of events) {
      s.points.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, t: Math.round(performance.now() - s.t0), p: ev.pressure || 0.5 });
    }
    redraw();
  };

  const onUp = (e: React.PointerEvent) => {
    const s = live.current;
    if (!s || s.pointerId !== e.pointerId) return;
    live.current = null;
    if (s.t0 < 0) {
      // pressing down cancelled the pending completion: an erase that touched nothing restarts it
      clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(() => void complete(), PAUSE_MS);
      return;
    }
    changed([...strokesRef.current, { id: shortId('s'), points: s.points }]);
  };

  return (
    <div className="flex h-dvh flex-col bg-white text-neutral-900">
      <header className="flex min-h-14 items-center gap-2 border-b border-neutral-200 px-3">
        <Link href="/notebooks" aria-label={t('sketch.back')} className="grid size-11 place-items-center rounded-full hover:bg-neutral-100">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{notebook.title}</h1>
        <span className="flex items-center gap-2 text-sm text-neutral-500" aria-live="polite">
          {thinking ? (
            <>
              <Spinner size={16} /> {t('sketch.thinking')}
            </>
          ) : error ? (
            <span className="max-w-64 truncate text-red-600" title={error}>
              {error}
            </span>
          ) : (
            strokes.length > 0 && !image && t('sketch.pause')
          )}
        </span>
        <div className="flex items-center gap-1">
          <ToolButton active={tool === 'pen'} label={t('sketch.pen')} onClick={() => setTool('pen')}>
            <PenLine size={20} />
          </ToolButton>
          <ToolButton active={tool === 'eraser'} label={t('sketch.eraser')} onClick={() => setTool('eraser')}>
            <Eraser size={20} />
          </ToolButton>
          <ToolButton label={t('sketch.undo')} disabled={!strokes.length} onClick={() => changed(strokes.slice(0, -1))}>
            <Undo2 size={20} />
          </ToolButton>
          <ToolButton label={t('sketch.clear')} disabled={!strokes.length} onClick={() => changed([])}>
            <Trash2 size={20} />
          </ToolButton>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
        <div ref={wrap} className="relative min-h-0 bg-white">
          <canvas
            ref={canvas}
            className="absolute inset-0 size-full touch-none"
            style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
        <div className="relative min-h-0 border-t border-neutral-200 bg-white md:border-t-0 md:border-l">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={t('sketch.completion')} className={clsx('absolute inset-0 size-full object-contain transition-opacity', thinking && 'opacity-50')} />
          ) : (
            <p className="absolute inset-0 grid place-items-center p-6 text-center text-neutral-400">{t('sketch.empty')}</p>
          )}
        </div>
      </main>
    </div>
  );
}

function ToolButton({ active, label, disabled, onClick, children }: { active?: boolean; label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx('grid size-11 place-items-center rounded-full disabled:opacity-30', active ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100')}
    >
      {children}
    </button>
  );
}
