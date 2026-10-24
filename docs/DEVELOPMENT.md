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
| `pnpm --filter frontend test` | history, autosave scheduler, ink split (Node test runner) |
| `pnpm contracts:emit && pnpm cas:test` | CAS oracle fixtures through SymPy (pytest) |
| `pnpm backend:test` | FastAPI template |
| `pnpm --filter frontend test:e2e` | Playwright: demo end to end with mock AI + real Pyodide CAS |
| `pnpm typecheck`, `pnpm lint` | TypeScript and ESLint |

## Supabase setup
1. Run the migrations in order (SQL editor or `npx supabase db push`):
   `0001_mn_notebooks.sql`, then `0002_mn_cloud_sync.sql` (autosave RPC, ink table, resources,
   settings, private Storage bucket `mn-resources` with its policies; ADR 0005). The app shows an
   error instead of saving until both are applied.
2. Authentication → URL configuration: Site URL and redirect URLs (`http://localhost:3000/**`, the
   deployed origin).
3. Authentication → Email templates → Magic link: paste `supabase/templates/magic_link.html`.
4. Authentication → Providers → Google: OAuth client from Google Cloud with redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`.
5. For testers outside your Supabase organisation, configure custom SMTP.
6. Optional, recommended: deploy the Storage sweeper and run it daily. It removes files whose
   resource row is gone (notebook deleted offline, account deleted) and uploads abandoned for a day:
   `npx supabase functions deploy mn-storage-sweeper`, then schedule it from Integrations → Cron
   (HTTP request to `https://<project-ref>.supabase.co/functions/v1/mn-storage-sweeper`, daily,
   `Authorization: Bearer <service role key>` stored in Vault).

## Layout
See `docs/plans/stage-1.md` for the repository map and `docs/design/v2.1-deltas.md` for how the
build differs from the v2.0 spec.

## Design system
Everything visual is defined once, in `frontend/src/app/globals.css`:

- **Brand inputs** (`:root`): `--brand-accent`, `--brand-ink`, `--brand-paper` and the status hues.
  Editing these re-skins the app; every other color (hover and soft shades, neutrals, borders,
  shadows, the loading shimmer) is mixed from them.
- **Semantic tokens** (`@theme`): colors (`accent`, `ink`, `muted`, `fill`, `hover`, `danger`, …),
  the type scale (`text-2xs` … `text-4xl`), radii, shadows, plus named layers (`z-sticky`,
  `z-overlay`, `z-popover`, …) and durations (`duration-fast`, `duration-base`).
- Components use only these tokens through Tailwind utilities. ESLint rejects raw colors,
  arbitrary font sizes, `white`/`black` utilities and numeric `z-*` in `.tsx` files.
- Code that draws outside CSS reads tokens through `frontend/src/ui/tokens.ts` (canvas ink, the
  browser theme color); JS animation takes its durations from `frontend/src/ui/motion.ts`, which
  mirrors the CSS durations.
- Exceptions: the handwriting-recognition image (`core/ink/raster.ts`) is always black on white,
  and the Google logo keeps its brand colors.
