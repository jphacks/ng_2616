import path from 'node:path';
import type { NextConfig } from 'next';

const origin = (url?: string) => {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
};

const isDev = process.env.NODE_ENV !== 'production';
const pyodide = origin(process.env.NEXT_PUBLIC_PYODIDE_INDEX_URL);
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWs = supabase.replace(/^http/, 'ws');

// Pyodide needs its pinned CDN origin for scripts/fetch and 'wasm-unsafe-eval' for WebAssembly.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''} ${pyodide}`,
  "worker-src 'self' blob:",
  `connect-src 'self' ${supabase} ${supabaseWs} ${pyodide}${isDev ? ' ws:' : ''}`,
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
  },
  transpilePackages: ['@mn/contracts'],
  turbopack: { root: path.join(__dirname, '..') },
  outputFileTracingRoot: path.join(__dirname, '..'),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
};

export default nextConfig;
