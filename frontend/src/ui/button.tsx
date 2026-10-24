'use client';

import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent-soft';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-soft disabled:bg-faint',
  secondary: 'bg-sheet text-ink shadow-card hover:bg-white disabled:text-faint',
  ghost: 'bg-transparent text-ink-soft hover:bg-black/5 disabled:text-faint',
  danger: 'bg-wrong-strong text-white hover:bg-wrong disabled:opacity-50',
  'accent-soft': 'bg-accent-soft text-accent-strong hover:bg-accent/15 disabled:opacity-50',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' && 'min-h-9 px-3 text-sm',
        size === 'md' && 'min-h-11 px-4 text-[15px]',
        size === 'lg' && 'min-h-12 px-5 text-base',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-11 w-11 select-none items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        active ? 'bg-ink text-white' : 'text-ink-soft hover:bg-black/5',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
