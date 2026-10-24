import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/server/supabase';
import { requestOrigin } from '@/server/urls';

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${requestOrigin(request)}/login`, { status: 303 });
}
