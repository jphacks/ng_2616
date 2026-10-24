'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';

export function SegmentedTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="inline-flex rounded-2xl bg-fill p-1">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={it.value === value}
          onClick={() => onChange(it.value)}
          className={clsx(
            'min-h-10 min-w-28 rounded-xl px-4 text-base font-medium transition-all',
            it.value === value ? 'bg-sheet text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
