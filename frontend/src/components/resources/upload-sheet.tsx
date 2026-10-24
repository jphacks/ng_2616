'use client';

import clsx from 'clsx';
import { Upload } from 'lucide-react';
import { useState } from 'react';
import type { ResourceKind, ResourceRecord } from '@/core/resources/db';
import { importFile, ResourceError, type ImportProgress } from '@/core/resources/service';
import { useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Spinner } from '@/ui/spinner';
import { KIND_ICON } from './resources-view';

const KINDS: ResourceKind[] = ['problem_sheet', 'textbook', 'notes'];

export function UploadSheet({ open, ownerId, notebookId, onClose, onImported }: { open: boolean; ownerId: string; notebookId: string; onClose: () => void; onImported: (r: ResourceRecord) => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ResourceKind>('problem_sheet');
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(10);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPdf = !!file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

  const reset = () => {
    setFile(null);
    setProgress(null);
    setError(null);
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    try {
      const r = await importFile(ownerId, notebookId, file, kind, isPdf ? { first, last } : null, setProgress);
      reset();
      onImported(r);
    } catch (e) {
      setProgress(null);
      setError(e instanceof ResourceError ? t(`res.err.${e.code}`) : e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('res.uploadTitle')}
      footer={
        <Button variant="primary" className="w-full" disabled={!file || !!progress} onClick={() => void run()} icon={progress ? <Spinner /> : <Upload size={18} />}>
          {progress && progress.phase === 'pages' ? t('res.importing', { done: progress.done + 1, total: progress.total }) : t('res.import')}
        </Button>
      }
    >
      <div className="space-y-6">
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-paper p-6 text-center hover:border-accent/50">
          <Upload className="text-accent" />
          <span className="text-[15px] font-medium">{file ? file.name : t('res.choose')}</span>
          <span className="text-[12px] text-muted">PDF · PNG · JPEG · WebP · ≤ 30 MiB</span>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </label>
        <div className="space-y-2">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">{t('res.kind')}</div>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={clsx('flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-medium ring-2 transition', kind === k ? 'bg-accent-soft text-accent-strong ring-accent' : 'bg-paper ring-transparent hover:ring-border')}
                >
                  <Icon size={20} />
                  {t(`res.kind.${k}`)}
                </button>
              );
            })}
          </div>
        </div>
        {isPdf && (
          <div className="space-y-2">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">{t('res.range')}</div>
            <div className="flex items-center gap-2 text-[15px]">
              <input type="number" min={1} value={first} onChange={(e) => setFirst(Math.max(1, Number(e.target.value) || 1))} className="h-11 w-20 rounded-xl bg-paper px-3 ring-1 ring-border" />
              <span className="text-muted">{t('res.from')}</span>
              <input type="number" min={first} value={last} onChange={(e) => setLast(Math.max(first, Number(e.target.value) || first))} className="h-11 w-20 rounded-xl bg-paper px-3 ring-1 ring-border" />
              <span className="text-muted">{t('res.to')}</span>
            </div>
          </div>
        )}
        {error && <p className="rounded-xl bg-wrong-soft p-3 text-[14px] text-wrong-strong">{error}</p>}
      </div>
    </Sheet>
  );
}
