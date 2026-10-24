# ADR 0006: A notebook's problem is its opening lines

**Status:** accepted (supersedes the problem card of spec §5 `Problem`, §8.3 and the parts of
§9.1, §11 and §12.2 that read the problem card)

## Context
Each notebook carried a `problem` (title, statement, given conditions, definitions, assumptions,
functions, unknowns) shown as a card above the lines. Only templates could fill it: no screen
edited it, so an empty notebook could never state assumptions such as `m > 0` or declare `ψ(x)`,
and nothing a template did could be reproduced by hand. The card also had its own title, so
renaming a notebook left the card and the notebook list thumbnail showing the old one.

## Decision
- **No problem card.** `Notebook.problem` is gone (schema `2.2.0`). A template opens with ordinary
  lines, one formula each: its statement, given equations, definitions, assumptions and function
  declarations, in the card's old order. The notebook title is the only title.
- **Given is a mark on a line.** A given line (`role: premise`) states the problem: the checker
  does not check it and later lines may use its relations. The line details sheet toggles the
  mark (`MARK_GIVEN`, undoable); a template marks its opening lines. Bare expressions on a given
  line ("a box of width $L$") state nothing and are not used.
- **Declarations are recognised by shape, marked or not.** The checker treats a formula as
  - an assumption: `x > 0`, `x \ge 0` (either way round), `x \ne 0`, `f(x) \ne 0`,
    `x \in \mathbb{Z}^{+}` / `\mathbb{Z}` / `\mathbb{N}` / `\mathbb{R}`, `a \le x \le b`, or a
    comma list of these; status none / `ASSUMPTION`;
  - a function declaration: a formula that is only `f(x, t)` with distinct variables; status
    none / `FUNCTION`.

  Assumptions apply to the lines after them. A function declaration applies to the whole page:
  the client re-reads every line with the declared functions (`withDeclarations`), using the
  LaTeX as recognised (`Segment.source_latex`), so a TDSE written above `\Psi(x,t)` reads `Ψ` as
  `Ψ(x,t)`. `f(x) = …` reads `f` as a function within its own formula.
- **Definitions are lines too.** A definition line written out again is classified DEFINITION,
  as the transcription of a problem definition was.
- **Old snapshots migrate on read.** `NotebookSchema` turns a `problem` into given lines at the
  top of the page (definitions keep `role: definition`); unknowns and the independent variable
  are dropped, since the checker finds both without them. The new lines are checked on open.

## Consequences
- A student opening an empty notebook can reproduce any template line by line; detection alone
  covers assumptions, functions and definitions, and the Given mark covers equations the problem
  states.
- Suggestions still wait for the student's first own line, and the scripted demo counts only
  lines that are not given.
- The suggestion request sends the declared functions and the given lines instead of the card.
- No database migration: the problem only ever lived inside the snapshot and preview JSON.
