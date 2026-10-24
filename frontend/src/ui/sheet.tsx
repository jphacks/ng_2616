'use client';

import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useOrientation } from './orientation';

/** Overlay panel: bottom sheet in portrait, side sheet in landscape. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const orientation = useOrientation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const side = orientation === 'landscape';
  return (
    <div className="absolute inset-0 z-40 flex" role="dialog" aria-modal="true">
      <button type="button" aria-label="close" className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <div
        className={clsx(
          'relative ml-auto flex animate-rise flex-col bg-sheet shadow-float',
          side ? 'h-full w-[min(440px,92%)] rounded-l-3xl' : 'mt-auto max-h-[78%] w-full rounded-t-3xl',
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1 text-lg font-semibold">{title}</div>
          <button type="button" aria-label="close" onClick={onClose} className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-black/5">
            <X size={20} />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
