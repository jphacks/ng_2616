import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/server/supabase';
import { requestOrigin, safeNext } from '@/server/urls';

/** OAuth (Google) and same-browser magic links: PKCE code exchange. */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const code = request.nextUrl.searchParams.get('code');
  const providerError = request.nextUrl.searchParams.get('error_description') ?? request.nextUrl.searchParams.get('error');
  if (providerError) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(providerError)}`);
  if (!code) return NextResponse.redirect(`${origin}/login?error=missing_code`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.code ?? error.message)}`);
  return NextResponse.redirect(`${origin}${next}`);
}
