import 'server-only';
import { z } from 'zod';

const thinking = z.enum(['minimal', 'low', 'medium', 'high']);

const schema = z.object({
  APP_ENV: z.enum(['local', 'preview', 'production']).default('local'),
  AI_EXECUTION: z.enum(['direct', 'relay']).default('direct'),
  LLM_PROVIDER: z.enum(['gemini', 'mock']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  LLM_MODEL_RECOGNIZE: z.string().default('gemini-3.8-flash'),
  LLM_MODEL_SUGGEST: z.string().default('gemini-3.5-flash-lite'),
  LLM_MODEL_OCR: z.string().default('gemini-3.5-flash-lite'),
  LLM_THINKING_RECOGNIZE: thinking.default('medium'),
  LLM_THINKING_SUGGEST: thinking.default('medium'),
  LLM_THINKING_OCR: thinking.default('minimal'),
  BACKEND_URL: z.string().optional(),
  BACKEND_API_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().default(''),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().default(''),
  NEXT_PUBLIC_AUTH_DEV_BYPASS: z.string().default('false'),
  NEXT_PUBLIC_ENABLED_FEATURES: z.string().default(''),
});

export type ServerEnv = z.infer<typeof schema> & { devBypass: boolean; buildId: string };

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.parse(Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v])));
  // The auth bypass exists only for `next dev` on a developer machine; production can never enable it.
  const devBypass = parsed.NEXT_PUBLIC_AUTH_DEV_BYPASS === 'true' && parsed.APP_ENV === 'local' && process.env.NODE_ENV === 'development';
  if (parsed.AI_EXECUTION === 'relay') {
    const url = parsed.BACKEND_URL ?? '';
    const local = parsed.APP_ENV === 'local' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
    if (!url.startsWith('https://') && !local) throw new Error('BACKEND_URL must be HTTPS (loopback HTTP only with APP_ENV=local)');
    if (!parsed.BACKEND_API_KEY || parsed.BACKEND_API_KEY.length < 43) throw new Error('BACKEND_API_KEY must hold at least 32 random bytes');
  }
  cached = { ...parsed, devBypass, buildId: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev' };
  return cached;
}

export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
