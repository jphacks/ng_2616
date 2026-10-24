'use client';

import { RotateCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';

const SIZES = { landscape: { w: 1180, h: 820 }, portrait: { w: 820, h: 1180 } } as const;

/**
 * iPad-style frame for desktop demos, enabled with ?frame=ipad. On a real tablet the app
 * always runs full screen.
 */
export function DeviceFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('frame') === 'ipad') {
      sessionStorage.setItem('mn.frame', 'ipad');
      setEnabled(true);
    } else if (params.get('frame') === 'off') {
      sessionStorage.removeItem('mn.frame');
    } else if (sessionStorage.getItem('mn.frame') === 'ipad') {
      setEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const fit = () => {
      const { w, h } = SIZES[orientation];
      setScale(Math.min(1, (window.innerWidth - 48) / (w + 36), (window.innerHeight - 96) / (h + 36)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [enabled, orientation]);

  if (!enabled) return <div className="h-dvh">{children}</div>;
  const { w, h } = SIZES[orientation];
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 overflow-hidden bg-frame-backdrop">
      <div style={{ width: (w + 36) * scale, height: (h + 36) * scale }}>
        <div
          className="origin-top-left rounded-frame bg-frame-bezel p-[18px] shadow-frame"
          style={{ width: w + 36, height: h + 36, transform: `scale(${scale})` }}
        >
          <div data-device-screen className="relative overflow-hidden rounded-frame-screen bg-paper" style={{ width: w, height: h, transform: 'translateZ(0)' }}>
            {children}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOrientation((o) => (o === 'landscape' ? 'portrait' : 'landscape'))}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-raised/80 px-4 text-md font-medium text-ink shadow-card hover:bg-raised"
      >
        <RotateCw size={16} /> {t('frame.rotate')}
      </button>
    </div>
  );
}
