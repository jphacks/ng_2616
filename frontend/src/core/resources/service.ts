'use client';

import { sha256Hex, sha256HexBytes } from '@mn/contracts';
import { uuid } from '@/core/ids';
import { pageKey, resourceDb, type PageRecord, type ResourceKind, type ResourceRecord } from './db';
import { canvasToBase64, canvasToBlob, closePdf, openPdf, pageText, renderPage } from './pdf';

export const MAX_RESOURCE_BYTES = 30 * 1024 * 1024;
export const MAX_RESOURCE_PAGES = 30;
const MIN_TEXT_CHARS = 60;
const THUMB_WIDTH = 240;

export interface ImportProgress {
  done: number;
  total: number;
  phase: 'reading' | 'pages' | 'done';
}

export class ResourceError extends Error {
  constructor(public code: 'TOO_LARGE' | 'UNSUPPORTED' | 'CORRUPTED' | 'TOO_MANY_PAGES', message: string) {
    super(message);
  }
}

async function fileHash(buf: ArrayBuffer): Promise<string> {
  return `sha256:${sha256HexBytes(new Uint8Array(buf))}`;
}

export async function listResources(ownerId: string, notebookId: string): Promise<ResourceRecord[]> {
  const rows = await resourceDb(ownerId).resources.where('notebook_id').equals(notebookId).toArray();
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getPages(ownerId: string, resourceId: string): Promise<PageRecord[]> {
  const rows = await resourceDb(ownerId).pages.where('resource_id').equals(resourceId).toArray();
  return rows.sort((a, b) => a.page - b.page);
}

export async function getFile(ownerId: string, resourceId: string): Promise<Blob | undefined> {
  return (await resourceDb(ownerId).files.get(resourceId))?.blob;
}

export async function removeResource(ownerId: string, resourceId: string) {
  const db = resourceDb(ownerId);
  await db.transaction('rw', db.resources, db.pages, db.files, async () => {
    await db.resources.delete(resourceId);
    await db.pages.where('resource_id').equals(resourceId).delete();
    await db.files.delete(resourceId);
  });
}

export async function setPinnedPage(ownerId: string, resourceId: string, page: number | undefined) {
  await resourceDb(ownerId).resources.update(resourceId, { pinned_page: page });
}

/** Import a PDF or photo. Pages are extracted locally; nothing is uploaded (spec §15.2). */
export async function importFile(
  ownerId: string,
  notebookId: string,
  file: File,
  kind: ResourceKind,
  range: { first: number; last: number } | null,
  onProgress?: (p: ImportProgress) => void,
): Promise<ResourceRecord> {
  if (file.size > MAX_RESOURCE_BYTES) throw new ResourceError('TOO_LARGE', 'file above 30 MiB');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = /^image\/(png|jpeg|webp)$/.test(file.type);
  if (!isPdf && !isImage) throw new ResourceError('UNSUPPORTED', 'only PDF, PNG, JPEG or WebP');
  onProgress?.({ done: 0, total: 1, phase: 'reading' });
  const buf = await file.arrayBuffer();
  const id = uuid();
  const db = resourceDb(ownerId);
  const pages: PageRecord[] = [];
  let pageCount = 1;
  let selected = [1];

  if (isPdf) {
    let doc;
    try {
      doc = await openPdf(buf.slice(0));
    } catch {
      throw new ResourceError('CORRUPTED', 'the PDF could not be opened (corrupted or encrypted)');
    }
    pageCount = doc.numPages;
    const first = Math.max(1, range?.first ?? 1);
    const last = Math.min(pageCount, range?.last ?? Math.min(pageCount, 10));
    if (last - first + 1 > MAX_RESOURCE_PAGES) throw new ResourceError('TOO_MANY_PAGES', 'select at most 30 pages');
    selected = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
    for (const [i, p] of selected.entries()) {
      onProgress?.({ done: i, total: selected.length, phase: 'pages' });
      const text = await pageText(doc, p);
      const canvas = await renderPage(doc, p, THUMB_WIDTH);
      pages.push({
        key: pageKey(id, p),
        resource_id: id,
        page: p,
        text,
        text_source: text.length >= MIN_TEXT_CHARS ? 'pdf' : 'none',
        ocr_state: text.length >= MIN_TEXT_CHARS ? 'not_needed' : 'needed',
        thumb: await canvasToBlob(canvas),
        width: canvas.width,
        height: canvas.height,
      });
    }
    await closePdf(doc);
  } else {
    const bitmap = await createImageBitmap(file);
    const scale = THUMB_WIDTH / bitmap.width;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    pages.push({ key: pageKey(id, 1), resource_id: id, page: 1, text: '', text_source: 'none', ocr_state: 'needed', thumb: await canvasToBlob(canvas), width: canvas.width, height: canvas.height });
  }

  const record: ResourceRecord = {
    id,
    notebook_id: notebookId,
    name: file.name,
    kind,
    mime: isPdf ? 'application/pdf' : file.type,
    bytes: file.size,
    sha256: await fileHash(buf),
    page_count: pageCount,
    pages: selected,
    created_at: new Date().toISOString(),
  };
  await db.transaction('rw', db.resources, db.pages, db.files, async () => {
    await db.resources.put(record);
    await db.pages.bulkPut(pages);
    await db.files.put({ resource_id: id, blob: new Blob([buf], { type: record.mime }) });
  });
  onProgress?.({ done: selected.length, total: selected.length, phase: 'done' });
  return record;
}

/** Built-in material (the demo problem sheet) stored as text pages. */
export async function addBuiltinResource(ownerId: string, notebookId: string, name: string, kind: ResourceKind, pagesText: string[]): Promise<ResourceRecord> {
  const id = uuid();
  const record: ResourceRecord = {
    id,
    notebook_id: notebookId,
    name,
    kind,
    mime: 'text/markdown',
    bytes: pagesText.join('').length,
    sha256: `sha256:${sha256Hex(pagesText.join('\f'))}`,
    page_count: pagesText.length,
    pages: pagesText.map((_, i) => i + 1),
    created_at: new Date().toISOString(),
    builtin: true,
  };
  const db = resourceDb(ownerId);
  await db.transaction('rw', db.resources, db.pages, async () => {
    await db.resources.put(record);
    await db.pages.bulkPut(pagesText.map((text, i) => ({ key: pageKey(id, i + 1), resource_id: id, page: i + 1, text, text_source: 'builtin' as const, ocr_state: 'not_needed' as const })));
  });
  return record;
}

/** Render one page (PDF or image) for OCR, at most 1000 px on the longest side. */
export async function pageImageForOcr(ownerId: string, resource: ResourceRecord, page: number) {
  const blob = await getFile(ownerId, resource.id);
  if (!blob) return null;
  if (resource.mime === 'application/pdf') {
    const doc = await openPdf(await blob.arrayBuffer());
    const canvas = await renderPage(doc, page, 1000);
    await closePdf(doc);
    return canvasToBase64(canvas);
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvasToBase64(canvas);
}

export async function savePageText(ownerId: string, resourceId: string, page: number, patch: Partial<PageRecord>) {
  await resourceDb(ownerId).pages.update(pageKey(resourceId, page), patch);
}
