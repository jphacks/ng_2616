# ADR 0001: Next.js App Router instead of a Vite SPA

**Status:** accepted (Stage 1)

## Context
The v2.0 spec assumed a Vite SPA plus a single Vercel function (`api/gateway.ts`). The team wants
React + Next.js, with no Vite anywhere in the toolchain.

## Decision
- Next.js 16 App Router. Every screen is a `page.tsx` (`/login`, `/notebooks`, `/notebooks/[id]`)
  with a root `layout.tsx`; endpoints that return data are `route.ts` (`/api/v1/[...path]`,
  `/auth/callback`, `/auth/confirm`, `/auth/signout`).
- `src/proxy.ts` (Next 16's renamed middleware) refreshes the Supabase session cookie and guards pages.
- The CAS worker (`public/cas/worker.js`) and pdf.js (`public/pdfjs/`) are served as static files and
  loaded at runtime, so the bundler never has to understand Pyodide or pdf.js.
- Unit tests use Node's test runner through `tsx`; E2E uses Playwright.

## Consequences
- One gateway route handler with an explicit route table keeps the spec's allowlist and JSON 404s.
- Server code (`src/server/**`) is guarded with `server-only`; secrets never reach the client bundle.
- Next 16 keeps its docs in `node_modules/next/dist/docs/` (see `frontend/AGENTS.md`).
