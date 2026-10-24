'use client';

import type * as PdfJs from 'pdfjs-dist';

type PdfJsModule = typeof PdfJs;

let loading: Promise<PdfJsModule> | null = null;

/**
 * pdf.js is copied to /pdfjs/ at build time and loaded at runtime instead of being bundled,
 * so the Next.js build never has to resolve it (optional, on-demand dependency).
 */
export function loadPdfJs(): Promise<PdfJsModule> {
  if (!loading) {
    const url = '/pdfjs/pdf.min.mjs';
    loading = (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<PdfJsModule>).then((m) => {
      m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return m;
    });
  }
  return loading;
}

const tasks = new WeakMap<object, { destroy(): Promise<void> }>();

export async function openPdf(data: ArrayBuffer) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

export type PdfDoc = Awaited<ReturnType<typeof openPdf>>;

/** pdf.js 6 tears a document down through its loading task. */
export async function closePdf(doc: PdfDoc | null | undefined) {
  if (!doc) return;
  await tasks.get(doc)?.destroy();
  tasks.delete(doc);
}

export async function pageText(doc: PdfDoc, pageNo: number): Promise<string> {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if ('str' in item) out += item.str + (item.hasEOL ? '\n' : ' ');
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export async function renderPage(doc: PdfDoc, pageNo: number, targetWidth: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));
}

export async function canvasToBase64(canvas: HTMLCanvasElement, maxSide = 1000): Promise<{ mime: 'image/jpeg'; data: string }> {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let src = canvas;
  if (scale < 1) {
    src = document.createElement('canvas');
    src.width = Math.round(canvas.width * scale);
    src.height = Math.round(canvas.height * scale);
    src.getContext('2d')!.drawImage(canvas, 0, 0, src.width, src.height);
  }
  const url = src.toDataURL('image/jpeg', 0.88);
  return { mime: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}
