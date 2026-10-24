'use client';

import { create } from 'zustand';

/**
 * Which pointers write on this device. `auto`: fingers write until a stylus is seen, then
 * scroll (palm rejection). `pen`: fingers always scroll. `touch`: fingers always write.
 */
export type InputMode = 'auto' | 'pen' | 'touch';

const STORAGE_KEY = 'mn.inputMode';

export const useDevicePrefs = create<{ inputMode: InputMode; setInputMode: (m: InputMode) => void }>((set) => ({
  inputMode: 'auto',
  setInputMode: (inputMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, inputMode);
    } catch {
      // storage can be unavailable (private mode); the choice still applies for this tab
    }
    set({ inputMode });
  },
}));

/** Runs after hydration, like the locale. */
export function initDevicePrefs() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === 'pen' || stored === 'touch') useDevicePrefs.setState({ inputMode: stored });
}
