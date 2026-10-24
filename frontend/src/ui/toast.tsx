'use client';

import clsx from 'clsx';
import { useNotebook } from '@/core/store/notebook-store';

export function Toast() {
  const toast = useNotebook((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-50 flex justify-center px-4">
      <div
        key={toast.id}
        role="status"
        className={clsx(
          'pointer-events-auto max-w-lg animate-rise rounded-2xl px-4 py-3 text-[15px] shadow-float',
          toast.tone === 'error' ? 'bg-wrong-strong text-white' : 'bg-ink text-white',
        )}
      >
        {toast.text}
      </div>
    </div>
  );
}
