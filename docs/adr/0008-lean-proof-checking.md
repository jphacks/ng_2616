# ADR 0008: Lean checks proof lines; the model routes each line

**Status:** accepted (Stage 1, local Lean; Azure later)

## Context
Spec §14.4 (S-05) treats Lean as a separate feature: a Proof panel where the student states a task,
confirms a typed formalization (`FormalExpr`), and lets the model write a structured proof plan that
a compiler turns into Lean. Lean proves the stated proposition; it never looks at what the student
wrote. The CAS checks the notebook's lines.

The product direction is different. CAS and Lean split the mathematics between them: the CAS does
the algebra, Lean handles proofs written in words ("Let ε > 0", "Choose δ = …", "By induction on n").
The model is the router that decides which checker a line needs. Lean also checks the model itself:
a suggested proof step is shown only when Lean accepts it. Hints for a proof step come from what
Lean could not prove.

The Azure backend is still being set up for PDF export, and `backend/` will change under other
people's hands. Mathlib's cache adds several GB to an image, which nobody else wants in theirs.

## Decision
- **Lines carry a route.** Recognition returns `route: cas | lean | none` with the segments
  (`Line.extensions.route`). `none` is filler ("Proof.", "∎"). A CAS line the CAS cannot read
  (`UNPARSED`, `UNSUPPORTED`, `TEXT_ONLY`) also goes to Lean once the notebook is a proof
  notebook, meaning it has a Lean theorem or a Lean line. Lines without a route are CAS lines, so
  older notebooks are unchanged.
- **One proof, one line at a time.** The theorem lives in `Notebook.extensions.lean.theorem`, tied
  to the hash of the given lines. The proof templates ship a reviewed statement; otherwise the
  model formalizes the given lines. Each proof line becomes one tactic snippet
  (`Line.extensions.lean.tactic`). A check sends the theorem plus every proof line's snippet
  (CAS lines included, so the Lean proof keeps going), and the model writes only the snippets
  that are missing. Earlier lines keep the translation they were checked with.
- **lean-worker** (`lean-worker/`) is a separate service: a FastAPI app with no model and no
  secrets around one Lean REPL. The imports are loaded once and reused: by default the part of
  Mathlib for school and first-year analysis (`LEAN_IMPORTS`; `Mathlib` on a server with room
  for it). It builds `set_option autoImplicit false in theorem mn_goal : <statement> := by`
  (an unknown name is an error, never a silent new variable) with the snippets indented under it,
  a `trace` marker after
  each snippet, and maps Lean's messages back to steps: `ok`, `failed`, `unchecked` (never reached)
  or `empty`. The whole check is `proved`, `incomplete` (with the remaining goals), `failed`,
  `invalid` or `timeout`. `proved` also requires `#print axioms` to show only `propext`,
  `Classical.choice` and `Quot.sound`.
- **Raw tactics, screened, instead of a plan language.** The spec's structured plan compiler
  (`FormalExpr`, a fixed tactic list, lemma IDs) is not built. The model writes Lean tactics, and
  the worker refuses anything but proof before Lean runs: `sorry`/`admit`/`native_decide`,
  options, commands (`#…`), declarations, attributes, `open`, metaprogramming
  (`run_tac`, `by_elab`, `elab`, `Lean.*`, `Meta`…), IO and `_root_`. Snippets cannot leave the
  `by` block because they are re-indented under it. This trades the plan compiler's guarantees
  for coverage and speed of building. The worker still decides only whether Lean accepts the
  fixed statement; the model never grades.
- **Translation fidelity is not checked yet.** The spec's "confirm the formal statement before
  proving" step is dropped for now: the model's formalization and translations are used as they
  are, shown in the line details sheet ("Theorem in Lean", "This line in Lean"). Add review if
  testing shows mistranslations matter.
- **Status.** A step Lean accepts is ok, labelled "Lean". A step it cannot prove is unknown, never
  wrong: an unproved step is not a false one, and red stays the CAS's counterexample-backed
  verdict. "Proof complete" marks the line that closes the theorem.
- **Repairs.** Up to three model calls per check (spec §14.4). A refused snippet the model wrote in
  this call is retried with Lean's message. A failure on an earlier, already-checked line is not.
- **Suggestions.** The suggestion model marks proof steps `route: lean`. The engine checks them
  with Lean as if written after the current line: accepted → verified ghost; refused → retried with
  Lean's message as checker feedback (never shown); Lean unreachable → amber, unverified (ADR 0003).
- **Where it runs.** The Next.js server does the model calls (`frontend/src/server/lean`, next to
  ADR 0004's direct AI) and calls lean-worker over loopback HTTP (`LEAN_WORKER_URL`, optional
  `LEAN_WORKER_KEY`). The gateway route is `POST /api/v1/lean/check`. Lean is on when the `lean`
  feature is enabled and the worker URL is set; otherwise proof lines say "Lean unavailable" and
  every CAS flow is unchanged.
- **Proof panel dropped.** Proof steps are notebook lines; there is no separate task list.

## Consequences
- On Azure the worker runs as a sidecar container beside the backend, not as a subprocess inside it
  as spec §3 draws it. `backend/` needs only small `/lean/*` routes that forward to it, added when
  the job system exists. Prompts move to Python as ADR 0004 already plans for the others.
- The worker image carries the Mathlib cache (several GB). On a 16 GB Windows laptop, `import
  Mathlib` did not finish in ten minutes, but the default subset loads in about 15 s (35 s
  cold), and both proof templates prove in it. Lemmas outside the subset are unknown to Lean, and
  the repair loop tells the model so. Full Mathlib needs several GB of memory and is for servers.
- Lean results are stored beside the CAS report, never inside it (Q-01 holds: no Lean writes to
  CAS status or bindings). Undo/Redo keep a verdict made for the same line version; a line whose
  proof context changed is checked again.
- Not built from S-05: `FormalExpr`, the plan compiler, the lemma-ID whitelist, statement
  confirmation, `Notebook.extensions.lean_tasks`, the formal-proofs section of TeX export.
