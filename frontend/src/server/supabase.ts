import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { DEV_USER_ID, serverEnv } from './env';

/** Cookie-bound client for Server Components and Route Handlers. One per request, never shared. */
export async function supabaseServer(): Promise<SupabaseClient> {
  const env = serverEnv();
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

export interface AuthedUser {
  id: string;
  email?: string;
  dev: boolean;
}

/**
 * Identity for an API request. The access token is always validated with the Auth server
 * (getUser), never trusted from the browser or from getSession() alone (spec §4.1).
 */
export async function authenticate(request: Request): Promise<AuthedUser | null> {
  const env = serverEnv();
  if (env.devBypass) return { id: DEV_USER_ID, email: 'dev@localhost', dev: true };
  if (!env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  let user: User | null = null;
  if (bearer) {
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    user = (await client.auth.getUser(bearer)).data.user;
  } else {
    user = (await (await supabaseServer()).auth.getUser()).data.user;
  }
  return user ? { id: user.id, email: user.email, dev: false } : null;
}
