'use client';

import { uuid } from '@/core/ids';
import { copyNotebookResources } from '@/core/resources/service';
import { getRepository } from './repo';

/** Card-menu actions that edit a stored notebook without opening it. */
export async function renameNotebook(ownerId: string, id: string, title: string): Promise<void> {
  const repo = getRepository(ownerId);
  const res = await repo.load(id);
  if (!res) throw new Error('not found');
  const saved = await repo.save({ ...res.notebook, title }, res.revision);
  if (!saved.ok) throw new Error(saved.message ?? saved.reason);
}

/** Copies the notebook under a new id, with its resources (files are copied inside Storage). */
export async function duplicateNotebook(ownerId: string, id: string, title: (original: string) => string): Promise<string> {
  const repo = getRepository(ownerId);
  const res = await repo.load(id);
  if (!res) throw new Error('not found');
  const copy = { ...res.notebook, id: uuid(), title: title(res.notebook.title).slice(0, 200) };
  const saved = await repo.save(copy, null);
  if (!saved.ok) throw new Error(saved.message ?? saved.reason);
  await copyNotebookResources(ownerId, id, copy.id).catch((e) => console.warn('[duplicate] resources', e));
  return copy.id;
}
