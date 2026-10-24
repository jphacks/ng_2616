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
| `pnpm lean:test` | lean-worker: source screening, message mapping; real Lean once built |
| `pnpm --filter frontend test:e2e` | Playwright: demo end to end with mock AI + real Pyodide CAS |
| `pnpm typecheck`, `pnpm lint` | TypeScript and ESLint |

## Lean proof checking (optional)
Proof lines are checked by `lean-worker`, a separate service holding Lean 4, Mathlib and the
Lean REPL ([ADR 0008](adr/0008-lean-proof-checking.md)). The toolchain, Mathlib and REPL are
pinned together in `lean-worker/lean/` (`lean-toolchain`, `lakefile.toml`, `lake-manifest.json`).

1. Install [elan](https://github.com/leanprover/elan) (it picks the toolchain from
   `lean-toolchain`).
2. `pnpm lean:setup` downloads Mathlib's prebuilt cache and builds the REPL. That's about 5 GB in
   `lean-worker/lean/.lake` (git-ignored). On Windows with a small system drive, point `.lake` at
   another disk first: `mklink /J lean-worker\lean\.lake D:\somewhere\lake`, and set
   `MATHLIB_CACHE_DIR` to a folder there too.
3. `pnpm lean:dev` starts the worker on `http://127.0.0.1:8100`. At startup it loads the part of
   Mathlib that proofs use (about 15 s; `LEAN_IMPORTS` in `lean-worker/.env` changes the list,
   `Mathlib` for all of it if the machine has the memory). `GET /health` reports `lean_ready`.
4. In `frontend/.env.local`, set `NEXT_PUBLIC_ENABLED_FEATURES=lean` and
   `LEAN_WORKER_URL=http://127.0.0.1:8100`. Lean needs a real model (`LLM_PROVIDER=gemini`); with
   the mock provider, proof lines show "Lean unavailable".

`pnpm lean:test` runs the worker's tests. The real-Lean ones, which prove both proof templates and
check that false statements and `sorry` never pass, skip until step 2 is done. For a container
instead: `cd lean-worker && docker compose up --build`. The image includes the Mathlib cache.

### On the Azure VM (not done yet)
`backend/compose.azure.yaml` marks where Lean joins. The worker needs no internet at run time, so
it fits on `compiler-private`:
- Service `lean-worker` with `build: { context: ../lean-worker }` on `compiler-private`. Copy the
  hardening from `lean-worker/compose.yaml`. The build downloads Mathlib's cache (about 5 GB of
  disk; the build needs egress, running does not).
- Environment: `APP_ENV=production` and a `LEAN_WORKER_KEY` of at least 32 random bytes. Without
  a key, `/check` answers 503 outside `APP_ENV=local`.
- `Caddyfile.azure`: `handle_path /lean/* { reverse_proxy lean-worker:8100 }`, with a response
  timeout above the worker's 20 s per check. The worker's own paths are `/health` and `/check`.
- Vercel: `NEXT_PUBLIC_ENABLED_FEATURES` gains `lean`, plus
  `LEAN_WORKER_URL=https://<vm-host>/lean` and the same `LEAN_WORKER_KEY`. `POST /api/v1/lean/check`
  has its own route with `maxDuration = 300` (one hard step took 110 s of model time).
- Untested in a container: the image runs the REPL through `lake env` with a read-only root
  filesystem. If Lake needs to write there, mount the project's `.lake` writable or drop
  `read_only` for this service.

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

## PDF export

Open a notebook, choose **Export PDF / PDF出力**, set the report title and optional name/student ID,
choose **Create report PDF**, then choose **Download PDF** when ready. These fields belong to the
report and never rename or edit the notebook. The report uses a separate A4 document layout with
problem/assumptions, solution/derivation, sources and a revision appendix, rather than copying app UI.
The current browser-only implementation needs no Azure service, backend URL, TeX installation or
additional environment variables. It includes unsaved edits, verification labels, PDF/AI sources
and revision history. Ink and hints are omitted; unfinished lines are noted. Closing the panel
cancels generation and leaves the notebook untouched.

Body text and formulas are embedded as high-resolution images, so they cannot be selected/searched
as PDF text. Export is limited to 500 lines, 50 pages and 30 MiB. Japanese glyphs use the device's
fonts. See [ADR 0005](adr/0005-browser-pdf-export.md) for the departure from the `.tex`/LuaLaTeX plan.

Run `pnpm --filter frontend test` for document unit tests and
`pnpm --filter frontend test:e2e tests/e2e/pdf-export.spec.ts` for browser export tests. The browser
tests do not depend on CAS/LLM availability. Setting `PDF_QA_DIR` saves the generated sample PDF
there for visual inspection; otherwise it stays in Playwright's temporary output directory.

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
