'use client';

import { create } from 'zustand';

export type LibrarySort = 'custom' | 'updated' | 'title';

/** Per-user notebook list preferences. Kept on this device until settings sync to Supabase. */
export interface LibraryPrefs {
  order: string[];
  sort: LibrarySort;
}

/** Where preferences live; swap the implementation to sync them with the account later. */
export interface PrefsStorage {
  load(ownerId: string): LibraryPrefs | null;
  save(ownerId: string, prefs: LibraryPrefs): void;
  clear(ownerId: string): void;
}

const key = (ownerId: string) => `mn.library.${ownerId}`;

const localPrefs: PrefsStorage = {
  load(ownerId) {
    try {
      const raw = JSON.parse(localStorage.getItem(key(ownerId)) ?? 'null') as Partial<LibraryPrefs> | null;
      if (!raw) return null;
      return {
        order: Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : [],
        sort: raw.sort === 'updated' || raw.sort === 'title' ? raw.sort : 'custom',
      };
    } catch {
      return null;
    }
  },
  save(ownerId, prefs) {
    try {
      localStorage.setItem(key(ownerId), JSON.stringify(prefs));
    } catch {
      // storage can be unavailable (private mode); the order still applies for this visit
    }
  },
  clear(ownerId) {
    try {
      localStorage.removeItem(key(ownerId));
    } catch {
      // nothing stored
    }
  },
};

const DEFAULTS: LibraryPrefs = { order: [], sort: 'custom' };

interface LibraryState extends LibraryPrefs {
  ownerId: string | null;
  init: (ownerId: string) => void;
  setOrder: (order: string[]) => void;
  setSort: (sort: LibrarySort) => void;
}

export const useLibraryPrefs = create<LibraryState>((set, get) => {
  const persist = () => {
    const { ownerId, order, sort } = get();
    if (ownerId) localPrefs.save(ownerId, { order, sort });
  };
  return {
    ...DEFAULTS,
    ownerId: null,
    init: (ownerId) => {
      if (get().ownerId === ownerId) return;
      set({ ownerId, ...(localPrefs.load(ownerId) ?? DEFAULTS) });
    },
    setOrder: (order) => {
      set({ order });
      persist();
    },
    setSort: (sort) => {
      set({ sort });
      persist();
    },
  };
});

export function clearLibraryPrefs(ownerId: string) {
  localPrefs.clear(ownerId);
  if (useLibraryPrefs.getState().ownerId === ownerId) useLibraryPrefs.setState({ ...DEFAULTS, ownerId: null });
}

/**
 * Custom order: notebooks the saved order does not know yet (just created, or made on
 * another device) come first by last edit, then the saved order.
 */
export function arrange<T extends { id: string; title: string; updated_at: string }>(items: readonly T[], prefs: LibraryPrefs, locale: string): T[] {
  const byUpdated = (a: T, b: T) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0);
  if (prefs.sort === 'updated') return [...items].sort(byUpdated);
  if (prefs.sort === 'title') return [...items].sort((a, b) => a.title.localeCompare(b.title, locale, { numeric: true }));
  const rank = new Map(prefs.order.map((id, i) => [id, i]));
  const unknown = items.filter((n) => !rank.has(n.id)).sort(byUpdated);
  const known = items.filter((n) => rank.has(n.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...unknown, ...known];
}
