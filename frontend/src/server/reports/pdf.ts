import 'server-only';
import { TexReportRequestSchema } from '@mn/contracts';
import { ZodError } from 'zod';
import { exportSnapshot, serializeNotebook, validateExportSnapshot } from '@/core/export/document';
import { serializeLatex } from '@/core/export/latex';
import { serverEnv } from '@/server/env';
import { fail, GatewayError, readJson } from '@/server/gateway/http';
import { authenticate } from '@/server/supabase';

const MAX_PDF_BYTES = 4 * 1024 * 1024;

/** This route accepts notebook data, never arbitrary TeX or a browser-selected compiler URL. */
export async function reportPdf(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const user = await authenticate(request);
    if (!user) throw new GatewayError(401, 'AUTH_REQUIRED', 'sign in required');
    const raw = await readJson(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new GatewayError(400, 'INVALID_REQUEST', 'invalid report input');
    // Bound tree depth before recursive Zod/IR validation, including direct API requests.
    const bounded = validateExportSnapshot((raw as Record<string, unknown>).notebook);
    const parsed = TexReportRequestSchema.safeParse({ ...raw, notebook: bounded });
    if (!parsed.success) throw new GatewayError(400, 'INVALID_REQUEST', 'invalid report input');
    const { notebook, language, report } = parsed.data;
    const snapshot = exportSnapshot(notebook);
    const { document } = serializeNotebook(snapshot, language, report);
    const tex = serializeLatex(document);
    const env = serverEnv();
    const endpoint = env.PDF_COMPILER_URL;
    const key = env.PDF_COMPILER_API_KEY;
    if (!endpoint || !key || key.length < 43) throw new GatewayError(503, 'TEX_COMPILER_UNAVAILABLE', 'configure the PDF compiler');
    const url = new URL(endpoint);
    const local = env.APP_ENV === 'local' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new GatewayError(503, 'TEX_COMPILER_UNAVAILABLE', 'invalid compiler configuration');
    const deadline = AbortSignal.timeout(45_000);
    const signal = AbortSignal.any([request.signal, deadline]);
    const response = await fetch(endpoint.replace(/\/$/, '') + '/api/v1/reports/compile', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key, 'X-User-Id': user.id },
      body: JSON.stringify({ tex }), signal, redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const codes = ['TEX_COMPILER_UNAVAILABLE', 'TEX_COMPILER_BUSY', 'TEX_COMPILE_TIMEOUT', 'TEX_COMPILE_FAILED', 'EXPORT_TOO_LARGE'];
      const code = codes.includes(error?.error?.code) ? error.error.code : 'TEX_COMPILE_FAILED';
      throw new GatewayError(response.status >= 400 && response.status < 600 ? response.status : 502, code, 'report compilation did not complete', true);
    }
    if (!response.body || !response.headers.get('content-type')?.startsWith('application/pdf')) throw new GatewayError(502, 'TEX_COMPILE_FAILED', 'invalid compiler response');
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > MAX_PDF_BYTES) throw new GatewayError(413, 'EXPORT_TOO_LARGE', 'compiled PDF exceeds 4 MiB');
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new GatewayError(502, 'TEX_COMPILE_FAILED', 'invalid PDF');
    return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="report.pdf"', 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } });
  } catch (error) {
    if (error instanceof GatewayError) return fail(requestId, error);
    if (error instanceof ZodError) return fail(requestId, new GatewayError(400, 'INVALID_REQUEST', 'invalid report input'));
    const code = error instanceof Error ? error.message : '';
    if (code === 'EXPORT_TOO_LARGE') return fail(requestId, new GatewayError(413, code, 'report too large'));
    if (code === 'IR_INVALID') return fail(requestId, new GatewayError(400, code, 'unsupported mathematical expression'));
    if (request.signal.aborted) return fail(requestId, new GatewayError(499, 'CANCELLED', 'report cancelled'));
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return fail(requestId, new GatewayError(504, 'TEX_COMPILE_TIMEOUT', 'report timed out', true));
    return fail(requestId, new GatewayError(502, 'TEX_COMPILE_FAILED', 'report could not be generated', true));
  }
}
