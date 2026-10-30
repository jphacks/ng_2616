# Optional features (Should / Could)

Stage 1 ships with every optional feature **off**, so this folder holds only the plug-in contract.

- Each feature lives in `src/features/<feature-id>/index.ts` and default-exports a `FeaturePlugin`
  (see `types.ts`).
- `scripts/gen-feature-registry.mjs` writes `registry.generated.ts` from
  `NEXT_PUBLIC_ENABLED_FEATURES` before `dev`/`build`. Only enabled features are imported, so a
  Must-only build never resolves their dependencies (for example Plotly or Lean clients).
- `src/core` must never import from `src/features`.
- Server-side counterparts live in `backend/app/features/<feature-id>/`; the effective flag is the
  intersection of the server's `ENABLED_FEATURES` and the frontend's.

| Feature | Spec | Planned slot |
|---|---|---|
| `hints` | S-01 | toolbar button + recovery sheet |
| `assist_modes`, `bridge` | S-02, S-03 | toolbar mode switch, multi-line candidates |
| `plot` | S-04 | replaced by graph lines in the core: an AI-suggested line drawn by matplotlib in `public/cas/graph-worker.js` |
| `lean` | S-05 | built into the line pipeline instead of a plug-in: proof lines go to lean-worker ([ADR 0008](../../../docs/adr/0008-lean-proof-checking.md)) |
| `autosave` | S-06 | background scheduler on `NotebookRepository` |
| `auto_submit` | C-01 | ink idle detector → Confirm |
| `resources` | C-02 | promoted to core in Stage 1 |
