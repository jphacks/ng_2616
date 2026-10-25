'use client';

import { Download, FileDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { Notebook } from '@mn/contracts';
import { ApiCallError } from '@/core/api/client';
import type { SessionUser } from '@/core/auth/browser';
import { compileReportPdf } from '@/core/export/compile';
import { serializeLatex } from '@/core/export/latex';
import { exportSnapshot, serializeNotebook, validateExportSnapshot, type ReportDetails } from '@/core/export/document';
import { useNotebook } from '@/core/store/notebook-store';
import { currentLocale, useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Spinner } from '@/ui/spinner';
import type { PdfProgress } from '@/core/export/browser-pdf';

type Result = { url: string; name: string; omitted: number };
/** Fields that open holding a suggested value: shown gray, printed as is, made solid on first touch. */
type Prefilled = 'author' | 'studentId' | 'course';

const SAMPLE_STUDENT_ID = '01234567';

export function PdfExport({ user }: { user: SessionUser }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PdfProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'tex' | 'browser'>('tex');
  const [texDownload, setTexDownload] = useState<{ url: string; name: string } | null>(null);
  const [report, setReport] = useState<ReportDetails>({ title: '', author: '', studentId: '' });
  const [prefilled, setPrefilled] = useState<ReadonlySet<Prefilled>>(new Set());
  const touch = (key: string) => setPrefilled((p) => {
    if (!p.has(key as Prefilled)) return p;
    const next = new Set(p);
    next.delete(key as Prefilled);
    return next;
  });
  const snapshotRef = useRef<Notebook | null>(null);
  const controller = useRef<AbortController | null>(null);
  const notebookId = useNotebook((s) => s.notebook?.id);

  useEffect(() => () => { controller.current?.abort(); }, [notebookId]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => () => { if (texDownload) URL.revokeObjectURL(texDownload.url); }, [texDownload]);

  const close = () => {
    controller.current?.abort();
    controller.current = null;
    setOpen(false); setBusy(false); setResult(null); setTexDownload(null);
    snapshotRef.current = null;
  };

  const start = () => {
    const notebook = useNotebook.getState().notebook;
    if (!notebook) return;
    snapshotRef.current = structuredClone(exportSnapshot(notebook));
    // an empty title prints the notebook's own title
    const author = user.name?.trim() ?? '';
    setReport({ title: '', author, studentId: SAMPLE_STUDENT_ID, homework: { course: t('pdf.defaultCourse'), institution: '', date: '', exercise: '', paper: 'letter', include_records: false } });
    setPrefilled(new Set<Prefilled>(author ? ['author', 'studentId', 'course'] : ['studentId', 'course']));
    setMethod('tex'); setTexDownload(null);
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
      ctl.signal.throwIfAborted();
      if (method === 'tex') setTexDownload({ url: URL.createObjectURL(new Blob([serializeLatex(document)], { type: 'application/x-tex;charset=utf-8' })), name: pdfFileName(document.title).replace(/\.pdf$/, '.tex') });
      const blob = method === 'tex' ? await compileReportPdf(snapshot, currentLocale(), report, ctl.signal) : await generateBrowserPdf(document, ctl.signal, (p) => {
        if (!ctl.signal.aborted) setProgress(p);
      });
      ctl.signal.throwIfAborted();
      setResult({ url: URL.createObjectURL(blob), name: pdfFileName(document.title), omitted });
    } catch (e) {
      if (!ctl.signal.aborted) {
        if (process.env.NODE_ENV === 'development' && !(e instanceof Error && e.message === 'EXPORT_TOO_LARGE')) console.warn('[pdf-export]', e instanceof Error ? e.message : 'PDF failed');
        const code = e instanceof ApiCallError ? e.code : e instanceof Error ? e.message : '';
        const errors: Record<string, string> = { TEX_COMPILER_UNAVAILABLE: 'pdf.compilerUnavailable', TEX_COMPILER_BUSY: 'pdf.compilerBusy', TEX_COMPILE_TIMEOUT: 'pdf.compileTimeout', TEX_COMPILE_FAILED: 'pdf.compileFailed', IR_INVALID: 'pdf.unsupportedMath' };
        setError(code === 'EXPORT_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE' ? method === 'tex' ? 'pdf.texTooLarge' : 'pdf.tooLarge' : errors[code] ?? 'pdf.failed');
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
      {open && createPortal(<div className="fixed inset-0 z-overlay"><Sheet open={open} onClose={close} title={t('pdf.export')} footer={
        busy ? <Button className="w-full" onClick={close}>{t('pdf.cancel')}</Button>
          : result ? <a href={result.url} download={result.name} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-base font-medium text-on-solid"><Download size={18} />{t('pdf.download')}</a>
            : <Button variant="primary" className="w-full" onClick={() => void run()}>{t(error ? 'pdf.retry' : 'pdf.generate')}</Button>
      }>
        <div className="space-y-4 text-base">
          <label className="block text-sm font-medium">{t('pdf.method')}
            <select value={method} disabled={busy} onChange={e => { setMethod(e.target.value as 'tex' | 'browser'); setResult(null); setTexDownload(null); setError(null); }} className="mt-1 h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-border">
              <option value="tex">{t('pdf.methodTex')}</option><option value="browser">{t('pdf.methodBrowser')}</option>
            </select>
          </label>
          <p>{t(method === 'tex' ? 'pdf.azure' : 'pdf.local')}</p>
          <p className="text-sm text-muted">{t('pdf.snapshot')}</p>
          <div className="space-y-3">
            {(['title', 'author', 'studentId'] as const).map((key) => (
              <label key={key} className="block text-sm font-medium">
                {t(`pdf.${key}`)}
                <input className={clsx('mt-1 h-11 w-full rounded-xl bg-paper px-3 text-base ring-1 ring-border', prefilled.has(key as Prefilled) && 'text-faint')} value={report[key]} maxLength={key === 'title' ? 200 : 100} disabled={busy}
                  onFocus={() => touch(key)}
                  onChange={(e) => { setReport((r) => ({ ...r, [key]: e.target.value })); setResult(null); setTexDownload(null); setError(null); }} />
              </label>
            ))}
          </div>
          {report.homework && method === 'tex' && <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">{t('pdf.homework')}</legend>
            <p className="text-sm text-muted">{t('pdf.templateHelp')}</p>
            {(['course', 'institution', 'date', 'exercise'] as const).map(key => <label key={key} className="block text-sm font-medium">{t(`pdf.${key}`)}
              <input value={report.homework![key]} maxLength={{ course: 120, institution: 200, date: 60, exercise: 40 }[key]} onFocus={() => touch(key)} onChange={e => { setReport(r => ({ ...r, homework: { ...r.homework!, [key]: e.target.value } })); setResult(null); setTexDownload(null); setError(null); }} className={clsx('mt-1 h-11 w-full rounded-xl bg-paper px-3 text-base ring-1 ring-border', prefilled.has(key as Prefilled) && 'text-faint')} />
            </label>)}
            <label className="block text-sm font-medium">{t('pdf.paper')}<select aria-label={t('pdf.paper')} value={report.homework.paper} onChange={e => { setReport(r => ({ ...r, homework: { ...r.homework!, paper: e.target.value as 'letter' | 'a4' } })); setResult(null); setTexDownload(null); }} className="mt-1 h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-border"><option value="letter">US Letter</option><option value="a4">A4</option></select></label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={report.homework.include_records} onChange={e => { setReport(r => ({ ...r, homework: { ...r.homework!, include_records: e.target.checked } })); setResult(null); setTexDownload(null); }} />{t('pdf.records')}</label>
          </fieldset>}
          {busy && <p role="status" className="flex items-center gap-2"><Spinner />{progress ? t('pdf.progress', { done: progress.done, total: progress.total }) : t('pdf.preparing')}</p>}
          {result && <><p role="status">{t('pdf.ready')}</p><p className="break-all text-sm text-muted">{result.name}</p>{result.omitted > 0 && <p>{t('pdf.omitted', { n: result.omitted })}</p>}</>}
          {error && <p role="alert" className="rounded-xl bg-wrong-soft p-3 text-wrong-strong">{t(error)}</p>}
          {texDownload && <a href={texDownload.url} download={texDownload.name} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent"><Download size={16} />{t('pdf.downloadTex')}</a>}
          <p className="text-xs text-muted">{t(method === 'tex' ? 'pdf.texNote' : 'pdf.imageNote')}</p>
        </div>
      </Sheet></div>, document.body)}
    </>
  );
}
