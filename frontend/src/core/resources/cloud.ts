'use client';

import { supabaseBrowser } from '@/core/auth/browser';
import type { PageRecord, ResourceKind, ResourceRecord } from './db';

/** Private bucket from supabase/migrations/0002; paths start with the owner's id (RLS). */
export const BUCKET = 'mn-resources';

export interface ResourceRow {
  id: string;
  owner_id: string;
  notebook_id: string;
  name: string;
  kind: ResourceKind;
  mime: string;
  bytes: number;
  sha256: string;
  page_count: number;
  pages: number[];
  pinned_page: number | null;
  builtin: boolean;
  object_path: string | null;
  upload_state: 'pending' | 'uploaded';
  created_at: string;
}

export interface PageRow {
  resource_id: string;
  page: number;
  text: string;
  text_source: PageRecord['text_source'];
  ocr_state: Exclude<PageRecord['ocr_state'], 'running'>;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export const folderOf = (ownerId: string, notebookId: string, resourceId: string) => `${ownerId}/${notebookId}/${resourceId}`;
export const sourcePath = (ownerId: string, notebookId: string, resourceId: string, mime: string) =>
  `${folderOf(ownerId, notebookId, resourceId)}/source.${EXT[mime] ?? 'bin'}`;
export const thumbPath = (ownerId: string, notebookId: string, resourceId: string, page: number) => `${folderOf(ownerId, notebookId, resourceId)}/thumb-${page}.png`;

export class CloudError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new CloudError(res.error.message, res.error.code);
  return res.data;
}

const db = () => supabaseBrowser();
const bucket = () => supabaseBrowser().storage.from(BUCKET);

export function toRow(r: ResourceRecord, ownerId: string): Omit<ResourceRow, 'created_at'> & { created_at: string } {
  return {
    id: r.id,
    owner_id: ownerId,
    notebook_id: r.notebook_id,
    name: r.name.slice(0, 255) || 'resource',
    kind: r.kind,
    mime: r.mime,
    bytes: r.bytes,
    sha256: r.sha256,
    page_count: r.page_count,
    pages: r.pages,
    pinned_page: r.pinned_page ?? null,
    builtin: !!r.builtin,
    object_path: r.builtin ? null : sourcePath(ownerId, r.notebook_id, r.id, r.mime),
    upload_state: r.builtin ? 'uploaded' : (r.upload_state ?? 'pending'),
    created_at: r.created_at,
  };
}

export function fromRow(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    notebook_id: row.notebook_id,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    bytes: Number(row.bytes),
    sha256: row.sha256,
    page_count: row.page_count,
    pages: row.pages,
    pinned_page: row.pinned_page ?? undefined,
    created_at: row.created_at,
    builtin: row.builtin || undefined,
    synced: true,
    upload_state: row.upload_state,
  };
}

export function toPageRow(p: PageRecord): PageRow {
  return {
    resource_id: p.resource_id,
    page: p.page,
    text: p.text.slice(0, 30000),
    text_source: p.text_source,
    // a page whose OCR was interrupted still needs it
    ocr_state: p.ocr_state === 'running' ? 'needed' : p.ocr_state,
    thumb_path: p.thumb_path ?? null,
    width: p.width ?? null,
    height: p.height ?? null,
  };
}

export async function listRows(notebookId: string): Promise<ResourceRow[]> {
  return check(await db().from('mn_resources').select('*').eq('notebook_id', notebookId).order('created_at')) as ResourceRow[];
}

export async function listPageRows(resourceId: string): Promise<PageRow[]> {
  return check(await db().from('mn_resource_pages').select('*').eq('resource_id', resourceId).order('page')) as PageRow[];
}

/** Inserts the rows; a resource the cloud already has counts as done. */
export async function insertResource(row: ReturnType<typeof toRow>, pages: PageRow[]) {
  const ins = await db().from('mn_resources').insert(row);
  if (ins.error && ins.error.code !== '23505') throw new CloudError(ins.error.message, ins.error.code);
  if (pages.length) check(await db().from('mn_resource_pages').upsert(pages, { onConflict: 'resource_id,page' }));
}

export async function updateResource(id: string, patch: Partial<Pick<ResourceRow, 'pinned_page' | 'upload_state' | 'name'>>) {
  check(await db().from('mn_resources').update(patch).eq('id', id));
}

export async function updatePage(resourceId: string, page: number, patch: Partial<Omit<PageRow, 'resource_id' | 'page'>>) {
  check(await db().from('mn_resource_pages').update(patch).eq('resource_id', resourceId).eq('page', page));
}

export async function deleteRow(id: string) {
  check(await db().from('mn_resources').delete().eq('id', id));
}

const isDuplicate = (e: { message?: string; statusCode?: string | number } | null) =>
  !!e && (String((e as { statusCode?: unknown }).statusCode) === '409' || /exists|duplicate/i.test(e.message ?? ''));

/** upsert=false: objects are never rewritten; one already there is the same file. */
export async function uploadObject(path: string, body: Blob, contentType: string) {
  const { error } = await bucket().upload(path, body, { contentType, upsert: false, cacheControl: '31536000' });
  if (error && !isDuplicate(error)) throw new CloudError(error.message);
}

export async function downloadObject(path: string): Promise<Blob> {
  const { data, error } = await bucket().download(path);
  if (error || !data) throw new CloudError(error?.message ?? 'download failed');
  return data;
}

export async function copyObject(from: string, to: string) {
  const { error } = await bucket().copy(from, to);
  if (error && !isDuplicate(error)) throw new CloudError(error.message);
}

export async function removeObjects(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket().remove(paths.slice(i, i + 100));
    if (error) throw new CloudError(error.message);
  }
}

/** Every file stored for a notebook's resources (source files and thumbnails). */
export async function notebookObjectPaths(ownerId: string, notebookId: string): Promise<string[]> {
  const rows = await listRows(notebookId);
  const paths: string[] = [];
  for (const r of rows) {
    if (r.object_path) paths.push(r.object_path);
    for (const p of r.pages) paths.push(thumbPath(ownerId, notebookId, r.id, p));
  }
  return paths;
}
