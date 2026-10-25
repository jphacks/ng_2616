# Integral worksheet: demo readiness review

Reviewed on 2026-10-25 for PR #59 (`feature/pdf-question-card`). The supplied one-page
`integral-worksheet.pdf` was used in Chromium with real Gemini image transcription and
suggestions, the branch's real CAS worker (SymPy 1.14.0, mpmath 1.4.1), and the Azure
LuaLaTeX compiler. Local development authentication was used; this is not a signed-in
acceptance test of the Vercel preview or an iPad handwriting test.

## Verdict

Retested after PR #67 was merged into main and main was merged into this branch. The supplied
worksheet now completes in the Japanese UI: image reading, a manual first suggestion, four
CAS-verified adopted steps, saving, and a two-page LuaLaTeX answer PDF. The final expression
matches the reference answer exactly. This review covers this worksheet and recorded flow.

## Source and expected answer

The source asks for

$$I=\int_1^2\frac{3x^2+5x+4}{x(x^2+1)}\,dx.$$

The reference derivation is

$$\frac{3x^2+5x+4}{x(x^2+1)}=\frac4x-\frac{x}{x^2+1}+\frac5{x^2+1},$$

$$I=\left[4\ln x-\tfrac12\ln(x^2+1)+5\arctan x\right]_1^2,$$

$$I=4\ln2-\tfrac12\ln(5/2)+5\left(\arctan2-\pi/4\right)
\approx3.923196128285915.$$

An independent native SymPy calculation matched this expression exactly. This is reference
math for QA, not a claim that the product has verified the complete derivation.

## Reproduced problems and PDF-side changes

- The local text path separated the upper integral limit, numerator and denominator. Its
  supposed whole-page problem included `\\int 2 \\,dx` and a different expression in place
  of the denominator. A PDF text layer is not a reliable two-dimensional math transcription.
  Adoption now requires explicit image-based AI reading. Extracted text is auxiliary input
  only; no questions are offered and adoption is disabled until that reading succeeds.
- The engine required a non-Given line even for a manual suggestion. A reviewed PDF question
  may now start on an explicit press. Templates still wait for the student to write;
  automatic solving on import is not enabled. Pending checks, unreadable math and wrong
  lines retain their guards.
- A given bare integral was omitted from the CAS's context, causing the first transformation
  to be labelled `NO_PARENT`/"suggested assumption". Its context is now sent as a calculation
  expression while its Given mark, PDF origin and notebook data are preserved. Ordinary
  given symbols and relations retain their existing semantics.
- AI rereading stays optional after the initial reading. Separate drafts, comparisons and
  reverting to the first AI reading remain available.
- Latest main's report-formatting fixes were merged. PR #67 was initially excluded while its
  author revised it; after its merge to main, the user authorized its integration and the
  successful run below was performed with those changes.

## Actual live run after the fixes

1. Resources -> Add resource -> supplied PDF -> Choose a problem from this PDF.
2. Read problems with AI: the fraction, exponents and limits 1 and 2 matched the source.
3. Adopt as given lines -> Suggest next step, without handwriting an initial line:
   a real suggestion request was sent and the partial-fraction rewrite was offered.
4. The real CAS returned `ok` for the partial-fraction rewrite. The following proposals were
   the antiderivative with `\\arctan(x)`, substitution of both bounds, and the final simplified
   expression. All four adopted lines have `proof.status = ok` and empty unverified-ancestor
   lists. No unverified-adoption confirmation was needed.
5. The final expression was
   `9/2 ln(2) - 1/2 ln(5) + 5 arctan(2) - 5 pi/4`. Evaluating the saved notebook's actual IR
   through the native SymPy converter and subtracting the independent reference expression
   simplified to zero; its numerical value is `3.923196128285915`. After that result the
   real model declined to propose another step.
6. The notebook saved, and Export PDF -> LaTeX template (Azure) produced a two-page PDF:
   problem and complete derivation, then the verification appendix. Both pages were rendered
   and visually inspected. The appendix identifies the four adopted steps as verified and
   retains their AI provenance. Sample author/ID/course values were cleared for this artifact.

The completed evidence PDF is `output/pdf/integral-solved-demo.pdf` in the task workspace.
The earlier `integral-live-validation.pdf` remains the historical intermediate-only report.

## Regression checks and demo gate

- TypeScript: passed.
- Frontend unit tests: 277 passed, one pre-existing component-render test skipped.
- IR and notebook contract tests: 114 passed, including inverse-trigonometric notation.
- Native CAS integral regression tests: two passed.
- PDF problem-import browser tests: 11 passed, including the supplied integral worksheet.
- Real image transcription, real suggestions, real CAS responses and real PDF compilation:
  checked separately from the scripted browser tests.

For the demo, start a new notebook, add the supplied PDF in Resources, choose the problem,
read it with AI, compare it with the original, and adopt it. Wait for the initial CAS check
to finish, then explicitly request the first next step. Adopt each displayed checked step;
subsequent requests can start automatically. The exact wording/number of intermediate AI
steps can vary; compare the final answer to the reference rather than expecting fixed text.
The completed PDF above is evidence of this scoped live run, not of every reviewed edge case.
