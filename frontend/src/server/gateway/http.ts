import 'server-only';
import type { ApiError } from '@mn/contracts';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8' };

export class GatewayError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export function ok<T>(requestId: string, data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, request_id: requestId, data }), { status, headers: NO_STORE });
}

export function fail(requestId: string, e: GatewayError): Response {
  const error: ApiError = { code: e.code, message: e.message, retryable: e.retryable };
  if (e.retryAfterMs) error.retry_after_ms = e.retryAfterMs;
  const headers: Record<string, string> = { ...NO_STORE };
  if (e.retryAfterMs) headers['Retry-After'] = String(Math.ceil(e.retryAfterMs / 1000));
  return new Response(JSON.stringify({ ok: false, request_id: requestId, error }), { status: e.status, headers });
}

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'request body above 2 MiB');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'request body above 2 MiB');
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayError(400, 'INVALID_REQUEST', 'body is not valid JSON');
  }
}
