'use client';

import type { UiLang } from '@mn/contracts';
import { DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { applyRemoteLibraryPrefs, cachedLibraryPrefs, parseLibraryPrefs, useLibraryPrefs, type LibraryPrefs } from '@/core/prefs/library';
import { useLocale } from '@/i18n';

/**
 * Account-wide settings in `mn_user_settings` (ADR 0005): the interface language and the
 * notebook list order/sort. localStorage stays as the first-paint cache. Last write wins.
 * Device-only choices (pen/touch input, the iPad frame) are not synced.
 */
interface Prefs {
  library?: LibraryPrefs;
  [key: string]: unknown;
}

const PUSH_DEBOUNCE_MS = 800;

let userId: string | null = null;
/** the row as last read or written, so a push never drops keys this build does not know */
let remotePrefs: Prefs = {};
let ready = false;
let applying = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const isLang = (v: unknown): v is UiLang => v === 'en' || v === 'ja';

function schedulePush() {
  if (!userId || !ready) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
}

async function push() {
  timer = null;
  const id = userId;
  if (!id) return;
  const lib = useLibraryPrefs.getState();
  const prefs: Prefs = { ...remotePrefs };
  if (lib.ownerId === id) prefs.library = { order: lib.order, sort: lib.sort };
  const { error } = await supabaseBrowser()
    .from('mn_user_settings')
    .upsert({ user_id: id, locale: useLocale.getState().locale, prefs }, { onConflict: 'user_id' });
  if (error) console.warn('[settings] not synced', error.message);
  else remotePrefs = prefs;
}

async function pull(id: string) {
  ready = false;
  const { data, error } = await supabaseBrowser().from('mn_user_settings').select('locale,prefs').eq('user_id', id).maybeSingle();
  if (userId !== id) return;
  if (error) {
    // table missing or offline: keep this device's settings and try again on the next sign-in
    console.warn('[settings] could not load', error.message);
    return;
  }
  ready = true;
  if (!data) {
    // first time for this account: upload what this device has
    remotePrefs = {};
    const cached = cachedLibraryPrefs(id);
    if (cached) remotePrefs.library = cached;
    void push();
    return;
  }
  remotePrefs = (data.prefs as Prefs | null) ?? {};
  applying = true;
  try {
    if (isLang(data.locale) && data.locale !== useLocale.getState().locale) useLocale.getState().setLocale(data.locale);
    const lib = parseLibraryPrefs(remotePrefs.library);
    if (lib) applyRemoteLibraryPrefs(id, lib);
  } finally {
    applying = false;
  }
}

/** Starts syncing for whoever is signed in; returns a cleanup. */
export function initSettingsSync(): () => void {
  if (DEV_BYPASS) return () => undefined;
  const { data: sub } = supabaseBrowser().auth.onAuthStateChange((_event, session) => {
    const id = session?.user.id ?? null;
    if (id === userId) return;
    userId = id;
    remotePrefs = {};
    ready = false;
    if (id) void pull(id);
  });
  const offLocale = useLocale.subscribe((s, prev) => {
    if (!applying && s.locale !== prev.locale) schedulePush();
  });
  const offLibrary = useLibraryPrefs.subscribe((s, prev) => {
    if (applying || !s.ownerId || s.ownerId !== userId) return;
    if (s.order !== prev.order || s.sort !== prev.sort) schedulePush();
  });
  return () => {
    sub.subscription.unsubscribe();
    offLocale();
    offLibrary();
  };
}

/** Sends a pending change now (before sign-out). */
export async function flushSettings() {
  if (!timer) return;
  clearTimeout(timer);
  await push();
}
