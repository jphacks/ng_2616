'use client';

import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOrientation, useOrientationContainer } from './orientation';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/** Overlay panel: bottom sheet in portrait, side sheet in landscape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const orientation = useOrientation();
  const orientationContainer = useOrientationContainer();
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const targetContainer =
    orientationContainer ?? (typeof document !== 'undefined' ? document.body : null);
  if (!targetContainer) return null;

  const side = orientation === 'landscape';
  const isBody = typeof document !== 'undefined' && targetContainer === document.body;

  const sheetContent = (
    <div
      className={clsx(isBody ? 'fixed inset-0' : 'absolute inset-0', 'z-overlay flex')}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" aria-label="close" className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <div
        className={clsx(
          'relative ml-auto flex animate-rise flex-col bg-sheet shadow-float',
          side ? 'h-full w-[min(440px,92%)] rounded-l-3xl' : 'mt-auto max-h-[78%] w-full rounded-t-3xl',
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1 text-2xl font-semibold">{title}</div>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-hover"
          >
            <X size={20} />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(sheetContent, targetContainer);
}
