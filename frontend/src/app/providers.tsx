'use client';

import { useEffect, type ReactNode } from 'react';
import { initLocale } from '@/i18n';
import { DeviceFrame } from '@/ui/device-frame';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initLocale();
  }, []);
  return <DeviceFrame>{children}</DeviceFrame>;
}
