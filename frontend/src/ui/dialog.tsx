'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './button';

const backdropClass =
  'fixed inset-0 z-40 min-h-dvh bg-ink/25 transition-opacity duration-150 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute';
const popupClass =
  'fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-3xl bg-sheet p-6 shadow-float outline-none ' +
  'transition-[scale,opacity] duration-150 ease-out motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0';

/** Confirmation for destructive or irreversible actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropClass} />
        <AlertDialog.Popup className={popupClass}>
          <div className="space-y-2">
            <AlertDialog.Title className="text-balance text-lg font-semibold">{title}</AlertDialog.Title>
            {description && <AlertDialog.Description className="text-pretty text-[15px] text-ink-soft">{description}</AlertDialog.Description>}
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" />}>{cancelLabel}</AlertDialog.Close>
            <Button
              variant={danger ? 'danger' : 'primary'}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onOpenChange(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** A one-field form, e.g. renaming a notebook. Errors stay next to the field. */
export function TextFieldDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue,
  maxLength,
  submitLabel,
  cancelLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  label: string;
  initialValue: string;
  maxLength?: number;
  submitLabel: string;
  cancelLabel: string;
  /** Resolves to an error message to show, or nothing on success. */
  onSubmit: (value: string) => Promise<string | void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = input.current?.value.trim() ?? '';
    if (!value) return;
    setBusy(true);
    try {
      const err = await onSubmit(value);
      if (err) setError(err);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) setError(null);
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={popupClass} initialFocus={input}>
          <Dialog.Title className="text-balance text-lg font-semibold">{title}</Dialog.Title>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-muted">{label}</span>
              <input
                ref={input}
                defaultValue={initialValue}
                maxLength={maxLength}
                aria-invalid={!!error}
                aria-describedby={error ? 'text-field-dialog-error' : undefined}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-12 rounded-xl bg-paper px-3 text-[16px] outline-none ring-1 ring-border focus:ring-2 focus:ring-accent/50"
              />
              {error && (
                <span id="text-field-dialog-error" role="alert" className="text-[13px] text-wrong-strong">
                  {error}
                </span>
              )}
            </label>
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button variant="ghost" />}>{cancelLabel}</Dialog.Close>
              <Button type="submit" variant="primary" disabled={busy}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
