'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

export const DEV_BYPASS = process.env.NEXT_PUBLIC_AUTH_DEV_BYPASS === 'true' && process.env.NODE_ENV === 'development';
export const DEV_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@localhost' };

let client: SupabaseClient | null = null;

/** The single browser Supabase client (spec §4.1). */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '');
  }
  return client;
}

export interface SessionUser {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
}

export function useSessionUser(): { user: SessionUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: SessionUser | null; loading: boolean }>({ user: DEV_BYPASS ? DEV_USER : null, loading: !DEV_BYPASS });
  useEffect(() => {
    if (DEV_BYPASS) return;
    const sb = supabaseBrowser();
    const map = (u: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null): SessionUser | null =>
      u ? { id: u.id, email: u.email, name: (u.user_metadata?.full_name as string) ?? undefined, avatar: (u.user_metadata?.avatar_url as string) ?? undefined } : null;
    sb.auth.getUser().then(({ data }) => setState({ user: map(data.user), loading: false }));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setState({ user: map(session?.user ?? null), loading: false }));
    return () => sub.subscription.unsubscribe();
  }, []);
  return state;
}

export const AUTH_PROVIDERS = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? 'google')
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is 'google' | 'azure' | 'github' => ['google', 'azure', 'github'].includes(s));
