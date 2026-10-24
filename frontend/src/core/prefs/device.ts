'use client';

import { create } from 'zustand';

/**
 * Which pointers write on this device. `auto`: fingers write until a stylus is seen, then
 * scroll (palm rejection). `pen`: fingers always scroll. `touch`: fingers always write.
 */
export type InputMode = 'auto' | 'pen' | 'touch';
export type InkWeight = 'thin' | 'medium' | 'thick';
export type ToolbarSide = 'left' | 'center' | 'right';

/** Stroke width for each weight; recognition always rasterizes at its own fixed width. */
export const INK_WEIGHTS: Record<InkWeight, number> = { thin: 2.6, medium: 3.4, thick: 4.6 };

/** Preferences that belong to this device (pen, screen, hand), so they are never synced. */
export interface DevicePrefs {
  inputMode: InputMode;
  inkWeight: InkWeight;
  /** a quick zig-zag over ink erases it */
  scratchToErase: boolean;
  toolbarSide: ToolbarSide;
  /** confirm a line after the pen rests for a moment */
  autoConfirm: boolean;
}

const DEFAULTS: DevicePrefs = { inputMode: 'auto', inkWeight: 'medium', scratchToErase: true, toolbarSide: 'center', autoConfirm: false };

// one key per preference, so the input mode stored by earlier versions keeps working
const KEYS: Record<keyof DevicePrefs, string> = {
  inputMode: 'mn.inputMode',
  inkWeight: 'mn.inkWeight',
  scratchToErase: 'mn.scratchToErase',
  toolbarSide: 'mn.toolbarSide',
  autoConfirm: 'mn.autoConfirm',
};

const ALLOWED: { [K in keyof DevicePrefs]: readonly string[] } = {
  inputMode: ['auto', 'pen', 'touch'],
  inkWeight: ['thin', 'medium', 'thick'],
  scratchToErase: ['true', 'false'],
  toolbarSide: ['left', 'center', 'right'],
  autoConfirm: ['true', 'false'],
};

export const useDevicePrefs = create<DevicePrefs & { setPref: <K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]) => void }>((set) => ({
  ...DEFAULTS,
  setPref: (key, value) => {
    try {
      localStorage.setItem(KEYS[key], String(value));
    } catch {
      // storage can be unavailable (private mode); the choice still applies for this tab
    }
    set({ [key]: value } as Partial<DevicePrefs>);
  },
}));

/** Runs after hydration, like the locale. */
export function initDevicePrefs() {
  const loaded: Partial<Record<keyof DevicePrefs, unknown>> = {};
  for (const key of Object.keys(KEYS) as (keyof DevicePrefs)[]) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEYS[key]);
    } catch {
      stored = null;
    }
    if (stored === null || !ALLOWED[key].includes(stored)) continue;
    loaded[key] = stored === 'true' ? true : stored === 'false' ? false : stored;
  }
  useDevicePrefs.setState(loaded as Partial<DevicePrefs>);
}
