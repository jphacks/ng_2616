'use client';

import Dexie, { type EntityTable } from 'dexie';

export type ResourceKind = 'problem_sheet' | 'textbook' | 'notes';

export interface ResourceRecord {
  id: string;
  notebook_id: string;
  name: string;
  kind: ResourceKind;
  mime: string;
  bytes: number;
  sha256: string;
  page_count: number;
  /** 1-based page numbers imported from the source */
  pages: number[];
  pinned_page?: number;
  created_at: string;
  /** built-in demo material rendered from text rather than a file */
  builtin?: boolean;
  /** this device's copy of the cloud row (ADR 0005): rows exist in the cloud */
  synced?: boolean;
  /** the source file (and thumbnails) reached Storage */
  upload_state?: 'pending' | 'uploaded';
  /** pinned page changed while the cloud was unreachable */
  meta_dirty?: boolean;
}

export type OcrState = 'not_needed' | 'needed' | 'running' | 'done' | 'failed';

export interface PageRecord {
  key: string; // `${resource_id}:${page}`
  resource_id: string;
  page: number;
  text: string;
  text_source: 'pdf' | 'ocr' | 'builtin' | 'none';
  ocr_state: OcrState;
  thumb?: Blob;
  /** Storage path of the thumbnail */
  thumb_path?: string;
  /** text or OCR state changed while the cloud was unreachable */
  text_dirty?: boolean;
  width?: number;
  height?: number;
}

export interface FileRecord {
  resource_id: string;
  blob: Blob;
}

class ResourceDb extends Dexie {
  resources!: EntityTable<ResourceRecord, 'id'>;
  pages!: EntityTable<PageRecord, 'key'>;
  files!: EntityTable<FileRecord, 'resource_id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ resources: 'id, notebook_id, created_at', pages: 'key, resource_id', files: 'resource_id' });
  }
}

export type { ResourceDb };

const dbs = new Map<string, ResourceDb>();
const dbName = (ownerId: string) => `mn_resources_${ownerId}`;

/** This device's cache of the owner's resources; Supabase holds the originals (ADR 0005). */
export function resourceDb(ownerId: string): ResourceDb {
  let db = dbs.get(ownerId);
  if (!db) {
    db = new ResourceDb(dbName(ownerId));
    dbs.set(ownerId, db);
  }
  return db;
}

export async function deleteOwnerResources(ownerId: string) {
  dbs.get(ownerId)?.close();
  dbs.delete(ownerId);
  await Dexie.delete(dbName(ownerId));
}

export const pageKey = (resourceId: string, page: number) => `${resourceId}:${page}`;
