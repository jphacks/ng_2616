'use client';

import { sha256Hex, sha256HexBytes } from '@mn/contracts';
import { DEV_BYPASS } from '@/core/auth/browser';
import { uuid } from '@/core/ids';
import * as cloud from './cloud';
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
  constructor(public code: 'TOO_LARGE' | 'UNSUPPORTED' | 'CORRUPTED' | 'TOO_MANY_PAGES' | 'OFFLINE', message: string) {
    super(message);
  }
}

async function fileHash(buf: ArrayBuffer): Promise<string> {
  return `sha256:${sha256HexBytes(new Uint8Array(buf))}`;
}

// Supabase holds resources (ADR 0005); IndexedDB caches them and keeps what has not reached the
// cloud yet (synced=false rows, pending uploads, dirty page text), retried on the next listing.
const cloudOn = !DEV_BYPASS;
const byCreated = (a: ResourceRecord, b: ResourceRecord) => a.created_at.localeCompare(b.created_at);

async function localResources(ownerId: string, notebookId: string) {
  return (await resourceDb(ownerId).resources.where('notebook_id').equals(notebookId).toArray()).sort(byCreated);
}

async function localPages(ownerId: string, resourceId: string) {
  return (await resourceDb(ownerId).pages.where('resource_id').equals(resourceId).toArray()).sort((a, b) => a.page - b.page);
}

export async function listResources(ownerId: string, notebookId: string): Promise<ResourceRecord[]> {
  const local = await localResources(ownerId, notebookId);
  if (!cloudOn) return local;
  let rows: cloud.ResourceRow[];
  try {
    rows = await cloud.listRows(notebookId);
  } catch (e) {
    console.warn('[resources] offline, showing this device’s copy', e);
    return local;
  }
  const db = resourceDb(ownerId);
  const remote = new Map(rows.map((r) => [r.id, r]));
  const out: ResourceRecord[] = [];
  for (const l of local) {
    const r = remote.get(l.id);
    if (!r && l.synced) {
      // deleted on another device
      await removeLocal(ownerId, l.id);
      continue;
    }
    if (!r) {
      const pushed = await pushResource(ownerId, l).catch((e) => (console.warn('[resources] upload later', e), l));
      out.push(pushed);
      continue;
    }
    let merged: ResourceRecord = { ...l, ...cloud.fromRow(r), pinned_page: l.meta_dirty ? l.pinned_page : (r.pinned_page ?? undefined), meta_dirty: l.meta_dirty };
    if (l.meta_dirty) {
      try {
        await cloud.updateResource(l.id, { pinned_page: l.pinned_page ?? null });
        merged = { ...merged, meta_dirty: undefined };
      } catch {
        // stays dirty
      }
    }
    await db.resources.put(merged);
    out.push(merged);
    remote.delete(l.id);
  }
  // new to this device: cache the rows; files and thumbnails download when opened
  for (const r of remote.values()) {
    const rec = cloud.fromRow(r);
    await db.resources.put(rec);
    out.push(rec);
  }
  for (const r of out) if (r.upload_state === 'pending' && r.synced && !r.builtin) void uploadFiles(ownerId, r);
  return out.sort(byCreated);
}

/** Pages with text; thumbnails are fetched unless `thumbs: false` (suggestion context). */
export async function getPages(ownerId: string, resourceId: string, opts: { thumbs?: boolean; remote?: boolean } = {}): Promise<PageRecord[]> {
  const local = await localPages(ownerId, resourceId);
  if (!cloudOn || opts.remote === false) return local;
  let rows: cloud.PageRow[];
  try {
    rows = await cloud.listPageRows(resourceId);
  } catch {
    return local;
  }
  if (rows.length === 0) return local; // not uploaded yet
  const db = resourceDb(ownerId);
  const byPage = new Map(local.map((p) => [p.page, p]));
  const merged: PageRecord[] = [];
  for (const row of rows) {
    const l = byPage.get(row.page);
    if (l?.text_dirty) {
      try {
        await cloud.updatePage(resourceId, row.page, pageFields(cloud.toPageRow(l)));
        merged.push({ ...l, text_dirty: undefined });
      } catch {
        merged.push(l);
      }
      continue;
    }
    merged.push({
      key: pageKey(resourceId, row.page),
      resource_id: resourceId,
      page: row.page,
      text: row.text,
      text_source: row.text_source,
      // keep a local "running" OCR; the cloud never stores it
      ocr_state: l?.ocr_state === 'running' ? 'running' : row.ocr_state,
      thumb: l?.thumb,
      thumb_path: row.thumb_path ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
    });
  }
  if (opts.thumbs !== false) {
    await Promise.all(
      merged.map(async (p, i) => {
        if (p.thumb || !p.thumb_path) return;
        try {
          merged[i] = { ...p, thumb: await cloud.downloadObject(p.thumb_path) };
        } catch {
          // shown without a thumbnail
        }
      }),
    );
  }
  await db.pages.bulkPut(merged);
  return merged;
}

const pageFields = (row: cloud.PageRow) => ({ text: row.text, text_source: row.text_source, ocr_state: row.ocr_state });

/** The original file, from this device's cache or downloaded once from Storage. */
export async function getFile(ownerId: string, resourceId: string): Promise<Blob | undefined> {
  const db = resourceDb(ownerId);
  const cached = (await db.files.get(resourceId))?.blob;
  if (cached || !cloudOn) return cached;
  const rec = await db.resources.get(resourceId);
  if (!rec || rec.builtin || !rec.synced) return undefined;
  const blob = await cloud.downloadObject(cloud.sourcePath(ownerId, rec.notebook_id, rec.id, rec.mime));
  await db.files.put({ resource_id: resourceId, blob });
  return blob;
}

async function removeLocal(ownerId: string, resourceId: string) {
  const db = resourceDb(ownerId);
  await db.transaction('rw', db.resources, db.pages, db.files, async () => {
    await db.resources.delete(resourceId);
    await db.pages.where('resource_id').equals(resourceId).delete();
    await db.files.delete(resourceId);
  });
}

/** Deletes the resource everywhere: Storage files, cloud rows, then this device's copy. */
export async function removeResource(ownerId: string, resourceId: string) {
  const rec = await resourceDb(ownerId).resources.get(resourceId);
  if (cloudOn && rec?.synced) {
    if (!rec.builtin) {
      await cloud.removeObjects([cloud.sourcePath(ownerId, rec.notebook_id, rec.id, rec.mime), ...rec.pages.map((p) => cloud.thumbPath(ownerId, rec.notebook_id, rec.id, p))]);
    }
    await cloud.deleteRow(resourceId);
  }
  await removeLocal(ownerId, resourceId);
}

/** Before a notebook is deleted: its files (rows go with the notebook by cascade). */
export async function removeNotebookResources(ownerId: string, notebookId: string) {
  if (cloudOn) {
    const paths = await cloud.notebookObjectPaths(ownerId, notebookId);
    if (paths.length) await cloud.removeObjects(paths);
  }
  for (const r of await localResources(ownerId, notebookId)) await removeLocal(ownerId, r.id);
}

export async function setPinnedPage(ownerId: string, resourceId: string, page: number | undefined) {
  const db = resourceDb(ownerId);
  await db.resources.update(resourceId, { pinned_page: page });
  if (!cloudOn) return;
  try {
    await cloud.updateResource(resourceId, { pinned_page: page ?? null });
  } catch {
    await db.resources.update(resourceId, { meta_dirty: true });
  }
}

/** Creates the cloud rows for a resource made on this device, then uploads its files. */
async function pushResource(ownerId: string, rec: ResourceRecord): Promise<ResourceRecord> {
  const pages = await localPages(ownerId, rec.id);
  const withPaths = pages.map((p) => (rec.builtin || !p.thumb ? p : { ...p, thumb_path: cloud.thumbPath(ownerId, rec.notebook_id, rec.id, p.page) }));
  await cloud.insertResource(cloud.toRow(rec, ownerId), withPaths.map(cloud.toPageRow));
  const synced: ResourceRecord = { ...rec, synced: true, upload_state: rec.builtin ? 'uploaded' : 'pending' };
  const db = resourceDb(ownerId);
  await db.resources.put(synced);
  await db.pages.bulkPut(withPaths);
  if (!rec.builtin) void uploadFiles(ownerId, synced);
  return synced;
}

const uploading = new Map<string, Promise<void>>();

/** Uploads the cached file and thumbnails; the row is marked uploaded once all are in Storage. */
function uploadFiles(ownerId: string, rec: ResourceRecord): Promise<void> {
  let job = uploading.get(rec.id);
  if (job) return job;
  job = (async () => {
    const db = resourceDb(ownerId);
    const file = (await db.files.get(rec.id))?.blob;
    // the file only exists on the device that imported it; that device finishes the upload
    if (!file) return;
    await cloud.uploadObject(cloud.sourcePath(ownerId, rec.notebook_id, rec.id, rec.mime), file, rec.mime);
    for (const p of await localPages(ownerId, rec.id)) {
      if (p.thumb && p.thumb_path) await cloud.uploadObject(p.thumb_path, p.thumb, 'image/png');
    }
    await cloud.updateResource(rec.id, { upload_state: 'uploaded' });
    await db.resources.update(rec.id, { upload_state: 'uploaded' });
  })()
    .catch((e) => console.warn('[resources] upload failed; retried later', e))
    .finally(() => uploading.delete(rec.id));
  uploading.set(rec.id, job);
  return job;
}

/** Resources this device made that the cloud does not have in full yet. */
export async function unsyncedResourceCount(ownerId: string): Promise<number> {
  if (!cloudOn) return 0;
  const all = await resourceDb(ownerId).resources.toArray();
  return all.filter((r) => !r.synced || (r.upload_state === 'pending' && !r.builtin) || r.meta_dirty).length;
}

/** Sends everything still pending (before sign-out clears this device). */
export async function pushAllResources(ownerId: string): Promise<void> {
  if (!cloudOn) return;
  const db = resourceDb(ownerId);
  for (const r of await db.resources.toArray()) {
    try {
      const rec = r.synced ? r : await pushResource(ownerId, r);
      if (rec.upload_state === 'pending' && !rec.builtin) await uploadFiles(ownerId, rec);
      if (rec.meta_dirty) {
        await cloud.updateResource(rec.id, { pinned_page: rec.pinned_page ?? null });
        await db.resources.update(rec.id, { meta_dirty: undefined });
      }
      for (const p of await localPages(ownerId, rec.id)) {
        if (!p.text_dirty) continue;
        await cloud.updatePage(rec.id, p.page, pageFields(cloud.toPageRow(p)));
        await db.pages.update(p.key, { text_dirty: undefined });
      }
    } catch (e) {
      console.warn('[resources] still pending', r.id, e);
    }
  }
}

/** Copies a notebook's resources to another notebook (save as copy, duplicate). */
export async function copyNotebookResources(ownerId: string, fromNotebook: string, toNotebook: string) {
  const db = resourceDb(ownerId);
  const sources = cloudOn ? (await cloud.listRows(fromNotebook)).map(cloud.fromRow) : await localResources(ownerId, fromNotebook);
  for (const src of sources) {
    const id = uuid();
    const pages = await getPages(ownerId, src.id, { thumbs: false });
    const rec: ResourceRecord = { ...src, id, notebook_id: toNotebook, created_at: new Date().toISOString(), synced: false, upload_state: undefined, meta_dirty: undefined };
    const copiedPages = pages.map((p) => ({ ...p, key: pageKey(id, p.page), resource_id: id, thumb_path: undefined, text_dirty: undefined }));
    if (cloudOn && src.upload_state === 'uploaded' && !src.builtin) {
      // server-side copy: nothing is downloaded
      await cloud.copyObject(cloud.sourcePath(ownerId, fromNotebook, src.id, src.mime), cloud.sourcePath(ownerId, toNotebook, id, src.mime));
      const withThumbs = await Promise.all(
        copiedPages.map(async (p) => {
          const from = cloud.thumbPath(ownerId, fromNotebook, src.id, p.page);
          const to = cloud.thumbPath(ownerId, toNotebook, id, p.page);
          try {
            await cloud.copyObject(from, to);
            return { ...p, thumb_path: to };
          } catch {
            return p;
          }
        }),
      );
      const done: ResourceRecord = { ...rec, synced: true, upload_state: 'uploaded' };
      await cloud.insertResource(cloud.toRow(done, ownerId), withThumbs.map(cloud.toPageRow));
      await db.resources.put(done);
      await db.pages.bulkPut(withThumbs);
      continue;
    }
    // not in Storage yet (or no cloud): copy this device's cache and push it like a new import
    const file = (await db.files.get(src.id))?.blob;
    await db.transaction('rw', db.resources, db.pages, db.files, async () => {
      await db.resources.put(rec);
      await db.pages.bulkPut(copiedPages);
      if (file) await db.files.put({ resource_id: id, blob: file });
    });
    if (cloudOn) await pushResource(ownerId, rec).catch((e) => console.warn('[resources] copy uploads later', e));
  }
}

/** Import a PDF or photo. Pages are extracted on this device, then rows and files go to Supabase. */
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
    synced: false,
  };
  await db.transaction('rw', db.resources, db.pages, db.files, async () => {
    await db.resources.put(record);
    await db.pages.bulkPut(pages);
    await db.files.put({ resource_id: id, blob: new Blob([buf], { type: record.mime }) });
  });
  onProgress?.({ done: selected.length, total: selected.length, phase: 'done' });
  if (!cloudOn) return record;
  // offline: kept on this device and sent with the next listing
  return pushResource(ownerId, record).catch((e) => {
    console.warn('[resources] saved on this device; uploads when online', e);
    return record;
  });
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
    synced: false,
  };
  const db = resourceDb(ownerId);
  await db.transaction('rw', db.resources, db.pages, async () => {
    await db.resources.put(record);
    await db.pages.bulkPut(pagesText.map((text, i) => ({ key: pageKey(id, i + 1), resource_id: id, page: i + 1, text, text_source: 'builtin' as const, ocr_state: 'not_needed' as const })));
  });
  if (!cloudOn) return record;
  return pushResource(ownerId, record).catch((e) => {
    console.warn('[resources] built-in sheet saved on this device; uploads when online', e);
    return record;
  });
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

/** Page text and OCR state: this device first, then the cloud ("running" stays local). */
export async function savePageText(ownerId: string, resourceId: string, page: number, patch: Partial<PageRecord>) {
  const db = resourceDb(ownerId);
  const key = pageKey(resourceId, page);
  await db.pages.update(key, patch);
  if (!cloudOn || patch.ocr_state === 'running') return;
  const p = await db.pages.get(key);
  if (!p) return;
  try {
    await cloud.updatePage(resourceId, page, pageFields(cloud.toPageRow(p)));
  } catch {
    await db.pages.update(key, { text_dirty: true });
  }
}
