'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Orientation = 'portrait' | 'landscape';

const Ctx = createContext<Orientation>('landscape');
const ContainerCtx = createContext<HTMLElement | null>(null);

export const useOrientation = () => useContext(Ctx);
export const useOrientationContainer = () => useContext(ContainerCtx);

/**
 * Orientation of the app's own box rather than the viewport, so the layout also responds
 * inside the iPad demo frame.
 */
export function OrientationProvider({ children, className }: { children: ReactNode; className?: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [o, setO] = useState<Orientation>('landscape');

  useEffect(() => {
    if (!container) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setO(width >= height ? 'landscape' : 'portrait');
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [container]);

  return (
    <div ref={setContainer} className={className} data-orientation={o}>
      <Ctx.Provider value={o}>
        <ContainerCtx.Provider value={container}>{children}</ContainerCtx.Provider>
      </Ctx.Provider>
    </div>
  );
}
