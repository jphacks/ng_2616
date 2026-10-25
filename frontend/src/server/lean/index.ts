import 'server-only';
import { serverEnv } from '@/server/env';
import { GeminiProvider } from '../ai/direct/providers/gemini';
import { MockProvider } from '../ai/direct/providers/mock';
import { LeanService } from './service';
import { HttpLeanWorker } from './worker';

let service: LeanService | null = null;

/** Lean is on when the feature is enabled and LEAN_WORKER_URL points at a running lean-worker. */
export function leanConfigured(): boolean {
  const env = serverEnv();
  return env.NEXT_PUBLIC_ENABLED_FEATURES.split(',').some((f) => f.trim() === 'lean') && !!env.LEAN_WORKER_URL;
}

export function getLeanService(): LeanService {
  if (service) return service;
  const env = serverEnv();
  const worker = leanConfigured() ? new HttpLeanWorker(env.LEAN_WORKER_URL!, env.LEAN_WORKER_KEY) : null;
  const llm = env.LLM_PROVIDER === 'gemini' && env.GEMINI_API_KEY ? new GeminiProvider(env.GEMINI_API_KEY) : new MockProvider();
  service = new LeanService(llm, worker, env);
  return service;
}
