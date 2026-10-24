'use client';

import { Download, FileDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Notebook } from '@mn/contracts';
import { exportSnapshot, serializeNotebook, validateExportSnapshot, type ReportDetails } from '@/core/export/document';
import { useNotebook } from '@/core/store/notebook-store';
import { currentLocale, useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Spinner } from '@/ui/spinner';
import type { PdfProgress } from '@/core/export/browser-pdf';

type Result = { url: string; name: string; omitted: number };

export function PdfExport() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PdfProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDetails>({ title: '', author: '', studentId: '' });
  const snapshotRef = useRef<Notebook | null>(null);
  const controller = useRef<AbortController | null>(null);
  const notebookId = useNotebook((s) => s.notebook?.id);

  useEffect(() => () => { controller.current?.abort(); }, [notebookId]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const close = () => {
    controller.current?.abort();
    controller.current = null;
    setOpen(false); setBusy(false); setResult(null);
    snapshotRef.current = null;
  };

  const start = () => {
    const notebook = useNotebook.getState().notebook;
    if (!notebook) return;
    snapshotRef.current = structuredClone(exportSnapshot(notebook));
    setReport({ title: notebook.title, author: '', studentId: '' });
    setOpen(true); setProgress(null); setResult(null); setError(null);
  };

  const run = async () => {
    if (!snapshotRef.current) return;
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setOpen(true); setBusy(true); setProgress(null); setResult(null); setError(null);
    try {
      // Capture now, including unsaved changes; subsequent writing cannot change this export.
      const snapshot = validateExportSnapshot(snapshotRef.current);
      const { document, omitted } = serializeNotebook(snapshot, currentLocale(), report);
      const { generateBrowserPdf, pdfFileName } = await import('@/core/export/browser-pdf');
      const blob = await generateBrowserPdf(document, ctl.signal, (p) => {
        if (!ctl.signal.aborted) setProgress(p);
      });
      ctl.signal.throwIfAborted();
      setResult({ url: URL.createObjectURL(blob), name: pdfFileName(document.title), omitted });
    } catch (e) {
      if (!ctl.signal.aborted) {
        if (process.env.NODE_ENV === 'development' && !(e instanceof Error && e.message === 'EXPORT_TOO_LARGE')) console.warn('[pdf-export]', e instanceof Error ? e.message : 'PDF failed');
        setError(e instanceof Error && e.message === 'EXPORT_TOO_LARGE' ? 'pdf.tooLarge' : 'pdf.failed');
      }
    } finally {
      if (controller.current === ctl) setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="md" icon={<FileDown size={18} />} onClick={start} disabled={busy} title={t('pdf.export')}>
        <span className="hidden lg:inline">{t('pdf.export')}</span>
        <span className="sr-only lg:hidden">{t('pdf.export')}</span>
      </Button>
      {open && createPortal(<div className="fixed inset-0 z-50"><Sheet open={open} onClose={close} title={t('pdf.export')} footer={
        busy ? <Button className="w-full" onClick={close}>{t('pdf.cancel')}</Button>
          : result ? <a href={result.url} download={result.name} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-medium text-white"><Download size={18} />{t('pdf.download')}</a>
            : <Button variant="primary" className="w-full" onClick={() => void run()}>{t(error ? 'pdf.retry' : 'pdf.generate')}</Button>
      }>
        <div className="space-y-4 text-[15px]">
          <p>{t('pdf.local')}</p>
          <p className="text-[13px] text-muted">{t('pdf.snapshot')}</p>
          <div className="space-y-3">
            {(['title', 'author', 'studentId'] as const).map((key) => (
              <label key={key} className="block text-[13px] font-medium">
                {t(`pdf.${key}`)}
                <input className="mt-1 h-11 w-full rounded-xl bg-paper px-3 text-[15px] ring-1 ring-border" value={report[key]} maxLength={key === 'title' ? 200 : 100} disabled={busy}
                  onChange={(e) => { setReport((r) => ({ ...r, [key]: e.target.value })); setResult(null); setError(null); }} />
              </label>
            ))}
          </div>
          {busy && <p role="status" className="flex items-center gap-2"><Spinner />{progress ? t('pdf.progress', { done: progress.done, total: progress.total }) : t('pdf.preparing')}</p>}
          {result && <><p role="status">{t('pdf.ready')}</p><p className="break-all text-[13px] text-muted">{result.name}</p>{result.omitted > 0 && <p>{t('pdf.omitted', { n: result.omitted })}</p>}</>}
          {error && <p role="alert" className="rounded-xl bg-wrong-soft p-3 text-wrong-strong">{t(error)}</p>}
          <p className="text-[12px] text-muted">{t('pdf.imageNote')}</p>
        </div>
      </Sheet></div>, document.body)}
    </>
  );
}
