'use client';

import { useEffect, type ReactNode } from 'react';
import { initDevicePrefs } from '@/core/prefs/device';
import { initLocale } from '@/i18n';
import { DeviceFrame } from '@/ui/device-frame';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initLocale();
    initDevicePrefs();
  }, []);
  return <DeviceFrame>{children}</DeviceFrame>;
}
