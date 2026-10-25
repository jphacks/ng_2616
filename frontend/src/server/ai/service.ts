import 'server-only';
import type {
  CandidateDraftResult,
  OcrPageInput,
  OcrPageResult,
  RecognizeInput,
  RecognizeResult,
  SuggestInput,
  TagInput,
  TagResult,
} from '@mn/contracts';
import { serverEnv } from '@/server/env';
import { DirectAiService } from './direct';
import { GeminiProvider } from './direct/providers/gemini';
import { MockProvider } from './direct/providers/mock';
import { RelayAiService } from './relay';

export interface CallCtx {
  userId: string;
  signal: AbortSignal;
}

/** What the gateway needs from "the AI backend", whether it runs in-process or on Azure. */
export interface AiService {
  recognize(input: RecognizeInput, ctx: CallCtx): Promise<RecognizeResult>;
  suggest(input: SuggestInput, ctx: CallCtx): Promise<CandidateDraftResult>;
  ocrPage(input: OcrPageInput, ctx: CallCtx): Promise<OcrPageResult>;
  tag(input: TagInput, ctx: CallCtx): Promise<TagResult>;
  status(): { provider: string; configured: boolean; mock: boolean };
}

let service: AiService | null = null;

export function getAiService(): AiService {
  if (service) return service;
  const env = serverEnv();
  if (env.AI_EXECUTION === 'relay') {
    service = new RelayAiService(env.BACKEND_URL!, env.BACKEND_API_KEY!);
  } else if (env.LLM_PROVIDER === 'gemini' && env.GEMINI_API_KEY) {
    service = new DirectAiService(new GeminiProvider(env.GEMINI_API_KEY), env);
  } else {
    service = new DirectAiService(new MockProvider(), env);
  }
  return service;
}
