# Development

## Prerequisites
- Node ≥ 20.9 (24 LTS recommended) and pnpm 10
- Python 3.12 with [uv](https://docs.astral.sh/uv/) (CAS tests, backend)
- Optional: Docker (backend container, local Supabase)

## First run
```sh
pnpm install
cp frontend/.env.example frontend/.env.local   # fill in Supabase + Gemini values
pnpm dev                                       # http://localhost:3000
```
`pnpm dev` first copies `packages/cas-core` and pdf.js into `frontend/public/` and generates the
feature registry. Add `?frame=ipad` to any URL for the iPad demo frame.

Without email access during local development, set `NEXT_PUBLIC_AUTH_DEV_BYPASS=true` (works only
with `APP_ENV=local` and `next dev`; notebooks are then stored on the device). Without a Gemini key,
set `LLM_PROVIDER=mock`: the demo notebook maps any ink to its scripted lines.

## Tests
| Command | What |
|---|---|
| `pnpm --filter @mn/contracts test` | parser, printer, IR limits, hashing (Node test runner) |
| `pnpm contracts:emit && pnpm cas:test` | CAS oracle fixtures through SymPy (pytest) |
| `pnpm backend:test` | FastAPI template |
| `pnpm --filter frontend test:e2e` | Playwright: demo end to end with mock AI + real Pyodide CAS |
| `pnpm typecheck`, `pnpm lint` | TypeScript and ESLint |

## Supabase setup
1. Run `supabase/migrations/0001_mn_notebooks.sql` (SQL editor or `npx supabase db push`).
   Until then the app saves notebooks on the device and shows a notice.
2. Authentication → URL configuration: Site URL and redirect URLs (`http://localhost:3000/**`, the
   deployed origin).
3. Authentication → Email templates → Magic link: paste `supabase/templates/magic_link.html`.
4. Authentication → Providers → Google: OAuth client from Google Cloud with redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`.
5. For testers outside your Supabase organisation, configure custom SMTP.

## Layout
See `docs/plans/stage-1.md` for the repository map and `docs/design/v2.1-deltas.md` for how the
build differs from the v2.0 spec.
