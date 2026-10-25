# ADR 0010: Notebook insights for the home page's progress section

**Status:** accepted

## Context
The home page should show what a student has worked on and how the notebook helped: a cloud of
subjects (bigger bubbles for subjects with more notebooks, pulled towards the center) beside counts
such as lines written with the assistant, mistakes caught and fixed, hints opened and days active.
Subjects are not something students enter, so a model reads them from each notebook.

## Decision
- **One row per notebook in `mn_notebook_insights`** (migration 0003), written by the client after
  every successful save (`core/insights/store.ts`, called from both repositories). A separate table
  keeps the save RPC and `mn_notebooks`' revision guard untouched; rows cascade with their notebook.
  The dev bypass keeps the same rows in IndexedDB.
- **Counts come from the snapshot** (`core/insights/stats.ts`): settled lines without the given
  lines, AI-written lines by mode, CAS verdicts (proof steps count through Lean instead), recoveries
  as mistakes caught/fixed, hint levels opened, Lean steps and proofs. `active_days` collects the
  local dates of saves (at most 400).
- **Three hidden subject tags**, broad field → subfield → topic, from a new job
  `POST /api/v1/notebooks/tags` (`LLM_MODEL_TAG`, default flash-lite with minimal thinking). The
  student's existing tags are sent along so the model reuses their spelling; tags are normalized
  to lower case with single spaces (`normalizeTag`). The hierarchy lets "analysis" grow big while
  "real analysis" and "complex analysis" stay separate, smaller bubbles.
- **Re-tagging is rationed**: a notebook is tagged once it has two settled lines, and again only
  when its text changed and either three lines were added or removed or six hours passed. One tag
  call runs at a time per browser; a failed call waits five minutes before that notebook retries.
- Notebooks saved before this existed are counted from the home page, up to 30 per visit, from
  their snapshot without ink.

## Consequences
- Tags are in English for every interface language; a translation step can come later.
- Relay mode needs the backend to implement `notebooks/tags`; until then tagging fails quietly
  and the counts still work.
- Without migration 0003 the client logs once and the section shows its empty state.
