'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Orientation = 'portrait' | 'landscape';

const Ctx = createContext<Orientation>('landscape');

export const useOrientation = () => useContext(Ctx);

/**
 * Orientation of the app's own box rather than the viewport, so the layout also responds
 * inside the iPad demo frame.
 */
export function OrientationProvider({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [o, setO] = useState<Orientation>('landscape');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setO(width >= height ? 'landscape' : 'portrait');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} data-orientation={o}>
      <Ctx.Provider value={o}>{children}</Ctx.Provider>
    </div>
  );
}
