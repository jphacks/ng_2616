# ADR 0004: Direct AI execution in Stage 1, relay later

**Status:** accepted (Stage 1)

## Context
The spec routes LLM calls through the Vercel gateway to a FastAPI service on Azure with a SQLite job
store. Stage 1 has no backend deployment.

## Decision
- `AiService` interface (`frontend/src/server/ai/service.ts`) with two implementations:
  `DirectAiService` (Next.js server calls Gemini, Stage 1) and `RelayAiService` (forwards to FastAPI
  with `X-API-Key` + validated `X-User-Id`, Stage 2).
- The browser contract is unchanged: `POST /api/v1/<task>` returns `202 {job}`; in direct mode the
  job is already terminal, in relay mode the client polls `GET /jobs/{id}` (already implemented).
- Direct mode keeps the spec's guards in-process: Idempotency-Key dedup (LRU), 2 concurrent LLM calls,
  4 unfinished per user, 32 waiting, per-task deadlines.

## Consequences
- Switching to Azure is a configuration change plus porting the provider/prompts to Python
  (`backend/app/llm`); the wire formats and fixtures are already shared via `packages/contracts/json`.
