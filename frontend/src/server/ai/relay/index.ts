import 'server-only';
import type {
  CandidateDraftResult,
  OcrPageInput,
  OcrPageResult,
  RecognizeInput,
  RecognizeResult,
  SuggestInput,
} from '@mn/contracts';
import { AiError } from '../errors';
import type { AiService, CallCtx } from '../service';

/**
 * Stage 2+: forwards to the FastAPI backend on Azure with the server-held key and the
 * validated user id (spec §4.2). The browser never sees BACKEND_URL or BACKEND_API_KEY.
 * Until the backend implements the job endpoints this returns FEATURE_DISABLED.
 */
export class RelayAiService implements AiService {
  constructor(
    private backendUrl: string,
    private apiKey: string,
  ) {}

  status() {
    return { provider: 'relay', configured: true, mock: false };
  }

  private async post<T>(path: string, input: unknown, ctx: CallCtx): Promise<T> {
    const res = await fetch(`${this.backendUrl.replace(/\/$/, '')}/api/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'x-user-id': ctx.userId },
      body: JSON.stringify({ input }),
      signal: ctx.signal,
      redirect: 'error',
    });
    if (res.status === 501 || res.status === 404) throw new AiError('FEATURE_DISABLED', `backend does not implement ${path} yet`);
    if (res.status === 429) throw new AiError('UPSTREAM_429', 'backend busy', true);
    if (!res.ok) throw new AiError('UPSTREAM_INVALID', `backend error ${res.status}`, res.status >= 500);
    const body = (await res.json()) as { ok: boolean; data?: T };
    if (!body.ok || body.data === undefined) throw new AiError('UPSTREAM_INVALID', 'backend returned an error');
    return body.data;
  }

  recognize(input: RecognizeInput, ctx: CallCtx): Promise<RecognizeResult> {
    return this.post('recognize', input, ctx);
  }

  suggest(input: SuggestInput, ctx: CallCtx): Promise<CandidateDraftResult> {
    return this.post('suggest', input, ctx);
  }

  ocrPage(input: OcrPageInput, ctx: CallCtx): Promise<OcrPageResult> {
    return this.post('resources/page', input, ctx);
  }
}
