'use client';

import { useEffect, type ReactNode } from 'react';
import { initDevicePrefs } from '@/core/prefs/device';
import { initSettingsSync } from '@/core/settings/sync';
import { initLocale } from '@/i18n';
import { DeviceFrame } from '@/ui/device-frame';
import { syncThemeColor } from '@/ui/tokens';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initLocale();
    initDevicePrefs();
    syncThemeColor();
    // account settings (language, notebook order) from Supabase, after the device's cached ones
    return initSettingsSync();
  }, []);
  return <DeviceFrame>{children}</DeviceFrame>;
}
