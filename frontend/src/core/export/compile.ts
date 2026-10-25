'use client';

import type { Notebook, ReportDetails, UiLang } from '@mn/contracts';
import { ApiCallError } from '@/core/api/client';

export async function compileReportPdf(notebook: Notebook, language: UiLang, report: ReportDetails, signal: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/v1/reports/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ notebook, language, report }), signal });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiCallError(data?.error?.code ?? 'TEX_COMPILE_FAILED', 'PDF compilation failed', response.status, !!data?.error?.retryable);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('application/pdf') || blob.size > 4 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') throw new Error('TEX_COMPILE_FAILED');
  return blob;
}
