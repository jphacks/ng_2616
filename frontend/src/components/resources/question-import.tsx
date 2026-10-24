'use client';

import { FileInput, ScanText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QuestionPageSchema, hasUnparsed, hasUnreadable, type QuestionPage } from '@mn/contracts';
import { ApiCallError } from '@/core/api/client';
import { prepareQuestionLines, questionContextHash, parseStatement, statementSource, type QuestionSelection, type QuestionSource } from '@/core/resources/question-adoption';
import { readQuestionPdf, type QuestionPdf } from '@/core/resources/question-pdf';
import { canvasToBase64, closePdf, renderPage, type PdfDoc } from '@/core/resources/pdf';
import { useNotebook } from '@/core/store/notebook-store';
import { useEngine } from '@/components/notebook/engine-context';
import { InlineSegments } from '@/components/notebook/segments';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import { Spinner } from '@/ui/spinner';
import { Tex } from '@/ui/tex';

const ERRORS: Record<string, string> = {
  QUESTION_FILE_TOO_LARGE: 'question.err.size', QUESTION_PAGE_LIMIT: 'question.err.pages',
  QUESTION_FILE_INVALID: 'question.err.file', QUESTION_PDF_UNREADABLE: 'question.err.file',
  QUESTION_CONTEXT_CHANGED: 'question.err.context', QUESTION_CHECKS_PENDING: 'toast.waitForChecks',
  QUESTION_MOCK_MISMATCH: 'question.err.mock', QUESTION_SYMBOL_INVALID: 'question.err.symbol',
  QUESTION_PREMISE_INVALID: 'question.err.premise', QUESTION_STATEMENT_INVALID: 'question.err.statement',
  QUESTION_OCR_UNAVAILABLE: 'question.err.unavailable', PDF_TRANSCRIPTION_INCOMPLETE: 'question.err.incomplete',
  QUESTION_PAGE_TOO_COMPLEX: 'question.err.complex',
};

export function QuestionImportButton({ loadFile, initialPage = 1 }: { loadFile?: () => Promise<File>; initialPage?: number }) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const engine = useEngine();
  const notebookId = useNotebook((s) => s.notebook?.id);
  const [open, setOpen] = useState(false);
  const [pdf, setPdf] = useState<QuestionPdf | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [selection, setSelection] = useState<QuestionSelection | null>(null);
  const [busy, setBusy] = useState<'file' | 'ai' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const openedDoc = useRef<PdfDoc | null>(null);
  const source = useRef<QuestionSource | null>(null);
  const previewHost = useRef<HTMLDivElement>(null);
  const page = pdf?.pages.find((p) => p.page === pageNo);
  const question = page?.questions.find((q) => q.id === selection?.questionId);

  const releaseDoc = useCallback(() => {
    const doc = openedDoc.current;
    openedDoc.current = null;
    if (doc) void closePdf(doc).catch(() => undefined);
  }, []);
  useEffect(() => () => { controller.current?.abort(); releaseDoc(); }, [notebookId, releaseDoc]);

  useEffect(() => {
    if (!pdf || !previewHost.current) return;
    let alive = true;
    void renderPage(pdf.doc, pageNo, 680).then((canvas) => {
      if (!alive || !previewHost.current) { canvas.width = 0; return; }
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      previewHost.current.replaceChildren(canvas);
    }).catch(() => { if (alive) setError('question.err.preview'); });
    return () => { alive = false; };
  }, [pdf, pageNo]);

  const segments = (() => {
    if (!selection || !question) return [];
    try { return parseStatement(selection.statement, question.functions); } catch { return []; }
  })();
  const needsReview = page && question && (hasUnparsed(segments) || hasUnreadable(segments) || page.lines.some((l) => question.line_ids.includes(l.id) && l.has_unreadable));

  const showError = (e: unknown) => {
    const code = e instanceof ApiCallError ? e.code : e instanceof Error ? e.message : '';
    setError(ERRORS[code] ?? 'question.err.generic');
  };
  const close = () => {
    controller.current?.abort(); controller.current = null;
    setOpen(false); setBusy(null); setPdf(null); setSelection(null); setError(null);
    releaseDoc(); source.current = null;
  };
  const readFile = async (file: File, ctl = new AbortController()) => {
    controller.current?.abort(); controller.current = ctl;
    setBusy('file'); setError(null); setSelection(null); setPdf(null); releaseDoc();
    try {
      const loaded = await readQuestionPdf(file, locale, ctl.signal);
      if (ctl.signal.aborted) { await closePdf(loaded.doc); return; }
      openedDoc.current = loaded.doc;
      if (source.current) source.current.fileName = file.name;
      setPdf(loaded); setPageNo(Math.min(initialPage, loaded.pages.length));
    } catch (e) { if (!ctl.signal.aborted) showError(e); }
    finally { if (controller.current === ctl) setBusy(null); }
  };
  const start = async () => {
    const nb = useNotebook.getState().notebook;
    if (!nb) return;
    source.current = { fileName: '', notebookId: nb.id, contextHash: questionContextHash(nb) };
    setOpen(true); setError(null); setSelection(null);
    if (loadFile) {
      const ctl = new AbortController(); controller.current = ctl; setBusy('file');
      try {
        const file = await loadFile();
        if (!ctl.signal.aborted) {
          // readFile owns its own controller; do not abort the signal passed into it.
          controller.current = null;
          await readFile(file, ctl);
        }
      } catch (e) { if (!ctl.signal.aborted) { showError(e); setBusy(null); } }
    }
  };
  const selectQuestion = (questionId: string, result: QuestionPage = page!) => {
    const q = result.questions.find((item) => item.id === questionId);
    setSelection(q ? { questionId: q.id, title: q.title, statement: statementSource(result, q.id), premiseIds: [] } : null);
    setError(null);
  };
  const transcribe = async () => {
    if (!pdf || !page) return;
    const ctl = new AbortController(); controller.current?.abort(); controller.current = ctl;
    setBusy('ai'); setError(null);
    try {
      const canvas = await renderPage(pdf.doc, pageNo, 1000);
      const image = await canvasToBase64(canvas); canvas.width = 0; canvas.height = 0;
      ctl.signal.throwIfAborted();
      const raw = await engine.transcribeQuestionPage({ page: pageNo, image, text: (pdf.text[pageNo - 1] ?? '').slice(0, 30000), ui_lang: locale }, ctl.signal);
      ctl.signal.throwIfAborted();
      const result = QuestionPageSchema.parse(raw);
      if (result.page !== pageNo) throw new Error('QUESTION_CONTEXT_CHANGED');
      setPdf((current) => current ? { ...current, pages: current.pages.map((p) => p.page === pageNo ? result : p) } : null);
      setSelection(null);
    } catch (e) { if (!ctl.signal.aborted) showError(e); }
    finally { if (controller.current === ctl) setBusy(null); }
  };
  const adopt = () => {
    if (!page || !selection || !source.current) return;
    try {
      const lines = prepareQuestionLines(page, source.current, selection);
      engine.adoptPdfQuestion(lines, source.current);
      close();
    } catch (e) { showError(e); }
  };

  return <>
    <Button variant="secondary" size="md" icon={<FileInput size={18} />} onClick={() => void start()} title={t('question.import')}>
      <span className="hidden lg:inline">{t('question.import')}</span><span className="sr-only lg:hidden">{t('question.import')}</span>
    </Button>
    {open && createPortal(<div className="fixed inset-0 z-overlay"><Sheet open onClose={close} title={t('question.import')}
      footer={<Button variant="primary" className="w-full" disabled={!!busy || !selection || !segments.length} onClick={adopt}>{t('question.adopt')}</Button>}>
      <div className="space-y-4 text-md">
        <p>{t('question.local')}</p>
        <label className="block space-y-2 font-medium">{t('question.file')}
          <input type="file" accept="application/pdf,.pdf" disabled={!!busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file); }} className="block w-full rounded-xl bg-paper p-3 text-sm" />
        </label>
        {busy && <p role="status" className="flex items-center gap-2"><Spinner />{t(busy === 'file' ? 'question.reading' : 'question.transcribing')}</p>}
        {error && <p role="alert" className="rounded-xl bg-wrong-soft p-3 text-wrong-strong">{t(error)}</p>}
        {pdf && page && <>
          <p className="break-all text-xs text-muted">{pdf.fileName} · {t('res.pages', { n: pdf.pages.length })}</p>
          <label className="block font-medium">{t('question.page')}
            <select value={pageNo} disabled={!!busy} onChange={(e) => { setPageNo(Number(e.target.value)); setSelection(null); setError(null); }} className="mt-1 h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-border">{pdf.pages.map((p) => <option key={p.page} value={p.page}>{t('res.page', { n: p.page })}</option>)}</select>
          </label>
          <details open><summary className="cursor-pointer py-2 font-medium">{t('question.original')}</summary><div ref={previewHost} className="max-h-60 overflow-auto rounded-xl border border-border bg-page" /></details>
          <p className="text-xs text-muted">{t(page.method === 'ai' ? 'question.aiRead' : 'question.textRead')}</p>
          {page.mock && <p className="text-wrong-strong">{t('question.mock')}</p>}
          <Button icon={<ScanText size={17} />} disabled={!!busy} onClick={() => void transcribe()}>{t('question.ai')}</Button>
          <p className="text-xs text-muted">{t('question.aiConsent')}</p>
          <label className="block font-medium">{t('question.choose')}
            <select value={selection?.questionId ?? ''} disabled={!!busy} onChange={(e) => selectQuestion(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-border">
              <option value="">{t('question.choosePlaceholder', { n: page.questions.length })}</option>
              {page.questions.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
          </label>
          {!page.questions.length && <p>{t('question.noQuestions')}</p>}
          {selection && question && <>
            <label className="block font-medium">{t('question.title')}<input maxLength={200} value={selection.title} disabled={!!busy} onChange={(e) => setSelection({ ...selection, title: e.target.value })} className="mt-1 h-11 w-full rounded-xl bg-paper px-3 ring-1 ring-border" /></label>
            <div className="rounded-xl bg-paper p-3 leading-loose"><InlineSegments segments={segments} /></div>
            {needsReview && <p className="rounded-xl bg-unknown-soft p-3">{t('question.unreadable')}</p>}
            <label className="block font-medium">{t('question.edit')}<textarea rows={5} value={selection.statement} disabled={!!busy} onChange={(e) => setSelection({ ...selection, statement: e.target.value })} className="mt-1 w-full rounded-xl bg-paper p-3 text-sm ring-1 ring-border" /></label>
            <p className="text-xs text-muted">{t('question.editHelp')}</p>
            <p className="text-xs text-muted">{t('question.autoSymbols')}</p>
            <fieldset className="space-y-2"><legend className="mb-2 font-medium">{t('question.premises')}</legend>
              {!question.premises.length && <p>{t('question.noPremises')}</p>}
              {question.premises.map((candidate) => <label key={candidate.id} className="flex min-h-11 items-start gap-3 rounded-xl bg-paper p-3">
                <input type="checkbox" className="mt-1 h-5 w-5" disabled={!!busy || !candidate.selectable} checked={selection.premiseIds.includes(candidate.id)} onChange={(e) => setSelection({ ...selection, premiseIds: e.target.checked ? [...selection.premiseIds, candidate.id] : selection.premiseIds.filter((id) => id !== candidate.id) })} />
                <span><span className="block text-xs text-muted">{t(`question.kind.${candidate.kind}`)}</span><Tex latex={candidate.latex} />{!candidate.selectable && <span className="block text-xs">{t('question.notSelectable')}</span>}</span>
              </label>)}
            </fieldset>
            <p className="text-xs text-muted">{t('question.domain')}</p>
            <p className="rounded-xl bg-accent-soft p-3">{t('question.replace')}</p>
          </>}
        </>}
      </div>
    </Sheet></div>, document.body)}
  </>;
}
