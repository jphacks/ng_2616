import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/server/supabase';
import { requestOrigin, safeNext } from '@/server/urls';

/**
 * Magic links from the custom email template (supabase/templates/magic_link.html).
 * token_hash works even when the email opens in a different browser than the one that asked.
 */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = (params.get('type') ?? 'email') as EmailOtpType;
  const next = safeNext(params.get('next'));
  if (!tokenHash) return NextResponse.redirect(`${origin}/login?error=missing_token`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.code ?? 'link_invalid')}`);
  return NextResponse.redirect(`${origin}${next}`);
}
