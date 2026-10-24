'use client';

import { DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { deleteLocalNotebooks, isCloudUnavailable } from '@/core/persistence/repo';
import { clearLibraryPrefs } from '@/core/prefs/library';
import { deleteOwnerResources } from '@/core/resources/db';

/** True when signing out also clears this device's copy of the user's data. */
export const signOutClearsDevice = () => !isCloudUnavailable() && !DEV_BYPASS;

/** Explicit sign-out clears this user's device data (spec §4.1); local-only notebooks are kept. */
export async function signOut(ownerId: string) {
  if (signOutClearsDevice()) {
    await deleteOwnerResources(ownerId);
    await deleteLocalNotebooks(ownerId);
    clearLibraryPrefs(ownerId);
  }
  if (!DEV_BYPASS) await supabaseBrowser().auth.signOut();
}
