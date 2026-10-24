import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth'];

/** Refreshes the Supabase session cookie and keeps signed-out visitors on /login. */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const bypass =
    process.env.NEXT_PUBLIC_AUTH_DEV_BYPASS === 'true' && process.env.APP_ENV === 'local' && process.env.NODE_ENV === 'development';
  let response = NextResponse.next({ request });
  if (bypass || !url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!data.user && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.search = path === '/' ? '' : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(to);
  }
  if (data.user && path === '/login') {
    const to = request.nextUrl.clone();
    to.pathname = '/notebooks';
    to.search = '';
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|cas/|pdfjs/|demo/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|py|json|mjs|js|wasm|pdf)$).*)'],
};
