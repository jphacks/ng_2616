# ADR 0002: LaTeX on the wire, deterministic LaTeX→IR parser

**Status:** accepted (Stage 1)

## Context
The spec has the recognizer (AI-R) and suggester (AI-S) return MathJSON IR directly. The IR is a
recursive tree; Gemini's structured output documents recursion only as a `$ref` to the root schema,
and LLMs transcribe handwriting into LaTeX far more reliably than into nested JSON.

## Decision
- LLM outputs are flat: `{segments: [{type: "text"|"math", content}]}` where math content is LaTeX.
- `packages/contracts/src/ir/parse.ts` converts LaTeX to IR deterministically. It never normalizes,
  simplifies or repairs; unsupported notation fails loudly (ink kept, line marked unreadable).
- The IR stays the stored truth. Display LaTeX is regenerated from IR by `print.ts`; the printer and
  parser are round-trip tested. Display LaTeX is never fed to the CAS.
- Declared functions (`Problem.functions`) decide whether `ψ(x)` is application or multiplication.

## Consequences
- The non-corrective guarantee (P-02) now rests on the LLM prompt plus a parser that cannot "fix"
  anything; GT-1 still needs real-ink trials.
- The same parser is used by the scripted demo, fixtures and the server, so test fixtures are written
  in LaTeX.
