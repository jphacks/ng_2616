import 'server-only';

/** Public origin of this request (works behind Vercel and HTTPS tunnels). */
export function requestOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (forwardedHost && process.env.NODE_ENV !== 'development') return `${proto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

/** Only same-site relative paths may be used as post-login destinations. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/notebooks';
  return next;
}
