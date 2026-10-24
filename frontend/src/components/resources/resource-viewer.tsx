'use client';

import clsx from 'clsx';
import { Pin, PinOff, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageRecord, ResourceRecord } from '@/core/resources/db';
import { closePdf, openPdf, renderPage, type PdfDoc } from '@/core/resources/pdf';
import { getFile, getPages, pageImageForOcr, savePageText, setPinnedPage } from '@/core/resources/service';
import { useEngine } from '@/components/notebook/engine-context';
import { useT } from '@/i18n';
import { IconButton } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { RichText } from '@/ui/tex';

/** Page preview with a thumbnail strip; PDFs render with pdf.js, built-in sheets as formatted text. */
export function ResourceViewer({ ownerId, resource, onChanged }: { ownerId: string; resource: ResourceRecord; onChanged: () => void }) {
  const t = useT();
  const engine = useEngine();
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [page, setPage] = useState(resource.pages[0] ?? 1);
  const [zoom, setZoom] = useState(1);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ocr, setOcr] = useState<'idle' | 'running' | 'failed'>('idle');
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getPages(ownerId, resource.id).then(setPages);
  }, [ownerId, resource.id]);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    let opened: PdfDoc | null = null;
    void getFile(ownerId, resource.id).then(async (blob) => {
      if (!blob || !alive) return;
      if (resource.mime === 'application/pdf') {
        opened = await openPdf(await blob.arrayBuffer());
        if (alive) setDoc(opened);
      } else {
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      }
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      void closePdf(opened);
    };
  }, [ownerId, resource.id, resource.mime]);

  // render the PDF page at the container width × zoom
  useEffect(() => {
    if (!doc || !host.current) return;
    let alive = true;
    const width = Math.min(1100, host.current.clientWidth - 48) * zoom * (window.devicePixelRatio || 1);
    void renderPage(doc, page, width).then((canvas) => {
      if (!alive || !host.current) return;
      canvas.style.width = `${canvas.width / (window.devicePixelRatio || 1)}px`;
      canvas.className = 'mx-auto rounded-lg shadow-card bg-page';
      host.current.replaceChildren(canvas);
    });
    return () => {
      alive = false;
    };
  }, [doc, page, zoom]);

  const current = pages.find((p) => p.page === page);

  // OCR pages without a text layer, only when opened
  useEffect(() => {
    if (!current || current.ocr_state !== 'needed' || resource.builtin) return;
    let alive = true;
    setOcr('running');
    void (async () => {
      await savePageText(ownerId, resource.id, page, { ocr_state: 'running' });
      const image = await pageImageForOcr(ownerId, resource, page);
      const text = image ? await engine.ocrPage(image) : null;
      await savePageText(ownerId, resource.id, page, text ? { text, text_source: 'ocr', ocr_state: 'done' } : { ocr_state: 'failed' });
      if (!alive) return;
      setOcr(text ? 'idle' : 'failed');
      setPages(await getPages(ownerId, resource.id));
    })();
    return () => {
      alive = false;
    };
  }, [current, engine, ownerId, page, resource]);

  const thumbs = useMemo(() => pages.map((p) => ({ page: p.page, url: p.thumb ? URL.createObjectURL(p.thumb) : null })), [pages]);
  useEffect(() => () => thumbs.forEach((th) => th.url && URL.revokeObjectURL(th.url)), [thumbs]);

  const pinned = resource.pinned_page === page;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-14 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{resource.name}</div>
          <div className="text-xs text-muted">
            {t('res.page', { n: page })}
            {ocr === 'running' && (
              <span className="ml-2 inline-flex items-center gap-1 text-accent">
                <Spinner size={12} /> {t('res.ocrRunning')}
              </span>
            )}
            {ocr === 'failed' && <span className="ml-2 text-danger">{t('res.ocrFailed')}</span>}
          </div>
        </div>
        {resource.kind === 'textbook' && (
          <button
            type="button"
            onClick={async () => {
              await setPinnedPage(ownerId, resource.id, pinned ? undefined : page);
              onChanged();
            }}
            className={clsx('inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-md font-medium', pinned ? 'bg-accent text-on-solid' : 'bg-accent-soft text-accent-strong')}
          >
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
            {pinned ? t('res.pinned') : t('res.pin')}
          </button>
        )}
        {!resource.builtin && (
          <>
            <IconButton label={t('res.zoomOut')} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              <ZoomOut size={19} />
            </IconButton>
            <IconButton label={t('res.zoomIn')} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              <ZoomIn size={19} />
            </IconButton>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {thumbs.length > 1 && (
          <div className="scrollbar-thin w-28 shrink-0 space-y-3 overflow-y-auto border-r border-border p-3">
            {thumbs.map((th) => (
              <button
                key={th.page}
                type="button"
                onClick={() => setPage(th.page)}
                className={clsx('block w-full overflow-hidden rounded-lg bg-page ring-2 transition', th.page === page ? 'ring-accent' : 'ring-transparent hover:ring-border')}
              >
                {th.url ? <img src={th.url} alt="" className="w-full" /> : <div className="aspect-[3/4]" />}
                <span className="block py-0.5 text-center text-2xs text-muted">{th.page}</span>
              </button>
            ))}
          </div>
        )}
        <div className="scrollbar-thin min-w-0 flex-1 overflow-auto bg-fill p-6">
          {resource.builtin ? (
            <article className="mx-auto max-w-3xl rounded-2xl bg-sheet p-10 text-lg shadow-card">
              <RichText text={current?.text ?? ''} />
            </article>
          ) : resource.mime === 'application/pdf' ? (
            <div ref={host} className="min-h-full">
              <div className="flex h-64 items-center justify-center text-muted">
                <Spinner />
              </div>
            </div>
          ) : imageUrl ? (
            <img src={imageUrl} alt={resource.name} className="mx-auto rounded-lg bg-page shadow-card" style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
