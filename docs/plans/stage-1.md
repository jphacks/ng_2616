# Stage 1 plan: Math Notebook prototype

Status: **built** on branch `stage-1-prototype` (2026-10-24). This file is the hand-off for later
stages; the spec is `docs/design/v2.0-en.md`, the changes to it are `docs/design/v2.1-deltas.md`.

## Goal

A Next.js tablet notebook with real ink, real handwriting recognition (Gemini reads a screenshot of
each line), real CAS checking (Pyodide + SymPy in a Web Worker), CAS-gated "ghost" AI suggestions,
a Resources tab whose content feeds the AI's context, Supabase sign-in, and the Schrödinger demo.
The FastAPI backend exists as a template; no Lean, no Azure.

## Decisions

| Topic | Decision |
|---|---|
| Framework | Next.js 16 App Router + React 19 + TypeScript; monorepo `frontend/`, `backend/`, `packages/` |
| Tests | Node's built-in test runner via `tsx` (unit), pytest (CAS, backend), Playwright (E2E). No Vite anywhere |
| CAS | Pyodide v314.0.7 + SymPy 1.14.0 in a module Web Worker (`frontend/public/cas/worker.js`) |
| LLM | Gemini (Interactions API): `gemini-3.8-flash` recognition (thinking low) and suggestions (medium); `gemini-3.5-flash-lite` page OCR |
| Sign-in | Supabase magic link + Google; open sign-up |
| Storage | Notebooks in Supabase `mn_notebooks` (owner-only RLS); resources on the device (IndexedDB) |
| AI steps the CAS cannot confirm | Shown as amber "unverified" ghosts; adoption needs a second confirmation |
| Deliberate wrong step | AI step φ(t)=e^{+iEt/ħ} is rejected by the checker → chip → explanation sheet → regenerated |
| Tablet testing | Vercel CLI deploys (GitHub org integration not required) |

## Scope

In: M-01 ink/confirm · M-02 recognition · M-03 problem card/presets · M-04/M-05 CAS statuses, evidence,
hints, revise · M-06 ghost suggestions · M-07 Undo/Redo · M-08 stale-response protection, failure
preservation · M-11 (partial) sign-in + manual save/open · Resources tab · EN/JP · both orientations ·
`?frame=ipad`.

Deferred: M-09 PDF → problem card via Azure · M-10 `.tex` export · job infrastructure + relay ·
all Should/Could features · Lean.

## Repository map

```
packages/contracts/   IR, LaTeX⇄IR parser/printer, Zod schemas, hashing, fixtures (TS)
packages/cas-core/    SymPy rules, shared by browser (Pyodide) and pytest (Python)
frontend/             Next.js app; src/server (gateway, AI), src/core (engine), src/components, src/ui
backend/              FastAPI template (health/capabilities live, jobs 501)
supabase/             migration, magic-link template, local config
docs/                 spec, deltas, ADRs, this plan
```

## Demo script (packages/contracts/fixtures/demo.ts)

| # | Who | Line | CAS result |
|---|---|---|---|
| 1 | student | V(x) = 0 | definition |
| 2 | student | iħ ∂Ψ/∂t = −(ħ²/2m) ∂²Ψ/∂x² | ✓ (TDSE with V:=0) |
| 3 | AI | Ψ(x,t) = ψ(x)φ(t) | assumption |
| 4–8 | AI | substitute, divide by ψφ, separation constant E, TISE, time equation | ✓ |
| 9✗ | AI | φ(t) = e^{+iEt/ħ} | wrong / SIGN → rejected, never shown |
| 9 | AI | φ(t) = e^{−iEt/ħ} | ✓ (substitution) |
| 10–13 | AI | ψ(0)=ψ(L)=0, k definition, ψ = A sin kx + B cos kx, B = 0 | given / def / ✓ / ✓ |
| 14 | AI | k = nπ/L | amber: keeps only some solutions |
| 15 | AI | Eₙ = n²π²ħ²/(2mL²) | ✓ local step (unverified: line 14) |
| 16 | AI | Ψ = Σ cₙ sin(nπx/L) e^{−iEₙt/ħ} | amber: sums unsupported |

## Milestones (all done in Stage 1)

M0 scaffold · M1 auth + migration · M2 contracts · M3 CAS · M4 shell · M5 recognition · M6 resources ·
M7 suggestions · M8 explanation sheet/revise · M9 save/open · M10 E2E + docs.

## Next stage candidates

1. Real-tablet pass: magic link + Google on the iPad via a Vercel preview, latency of Gemini
   recognition (target median ≤ 4 s), Pyodide speed on the device.
2. Relay mode: port `frontend/src/server/ai/direct` to `backend/app/llm`, SQLite job store and
   dispatcher, Azure deployment with Caddy.
3. M-09 PDF import into the problem card (Storage upload → backend) and M-10 `.tex` export.
4. CAS: Σ term-by-term superposition, subset-of-solutions with nontriviality assumptions, more
   physics identities; extend the oracle fixtures first.
5. Should features via `src/features/` (hints, plot, autosave first).
