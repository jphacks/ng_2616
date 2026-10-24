'use client';

import { DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { flushOpenNotebooks } from '@/core/persistence/autosave';
import { countPending, deleteOutbox, pushAllPending } from '@/core/persistence/outbox';
import { deleteLocalNotebooks, importDeviceNotebooks, isCloudUnavailable } from '@/core/persistence/repo';
import { clearLibraryPrefs } from '@/core/prefs/library';
import { deleteOwnerResources } from '@/core/resources/db';
import { pushAllResources, unsyncedResourceCount } from '@/core/resources/service';
import { flushSettings } from '@/core/settings/sync';
import { currentLocale, translate } from '@/i18n';

/** True when signing out also clears this device's copy of the user's data. */
export const signOutClearsDevice = () => !isCloudUnavailable() && !DEV_BYPASS;

const copyTitle = (title: string) => translate(currentLocale(), 'sync.copyTitle', { title });

/** Sends everything this device has not synced yet; returns how many items are still unsent. */
export async function syncBeforeSignOut(ownerId: string): Promise<number> {
  if (!signOutClearsDevice()) return 0;
  await flushOpenNotebooks();
  await importDeviceNotebooks(ownerId, copyTitle).catch(() => 0);
  await pushAllPending(ownerId, copyTitle);
  await pushAllResources(ownerId);
  await flushSettings();
  return (await countPending(ownerId)) + (await unsyncedResourceCount(ownerId));
}

/** Items this device holds that the cloud does not have yet (shown before signing out). */
export async function unsyncedCount(ownerId: string): Promise<number> {
  if (!signOutClearsDevice()) return 0;
  return (await countPending(ownerId)) + (await unsyncedResourceCount(ownerId));
}

/**
 * Explicit sign-out clears this user's device data (spec §4.1) after sending what it can;
 * the dev bypass keeps its device-only notebooks.
 */
export async function signOut(ownerId: string) {
  if (signOutClearsDevice()) {
    await syncBeforeSignOut(ownerId).catch((e) => console.warn('[sign-out] sync', e));
    await deleteOwnerResources(ownerId);
    await deleteLocalNotebooks(ownerId);
    await deleteOutbox(ownerId);
    clearLibraryPrefs(ownerId);
  }
  if (!DEV_BYPASS) await supabaseBrowser().auth.signOut();
}
