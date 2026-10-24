'use client';

import clsx from 'clsx';
import { useNotebook } from '@/core/store/notebook-store';

export function Toast() {
  const toast = useNotebook((s) => s.toast);
  const set = useNotebook((s) => s.set);
  if (!toast) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-50 flex justify-center px-4">
      <div
        key={toast.id}
        role="status"
        className={clsx(
          'pointer-events-auto flex max-w-lg animate-rise items-center gap-3 rounded-2xl text-[15px] shadow-float',
          toast.action ? 'py-1.5 pr-1.5 pl-4' : 'px-4 py-3',
          toast.tone === 'error' ? 'bg-wrong-strong text-white' : 'bg-ink text-white',
        )}
      >
        <span className="text-pretty">{toast.text}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.run();
              set('toast', null);
            }}
            className="min-h-10 shrink-0 rounded-xl px-3 font-semibold text-accent-soft hover:bg-white/10"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
