# Integral worksheet: demo readiness review

Reviewed on 2026-10-25 for PR #59 (`feature/pdf-question-card`). The supplied one-page
`integral-worksheet.pdf` was used in Chromium with real Gemini image transcription and
suggestions, the branch's real CAS worker (SymPy 1.14.0, mpmath 1.4.1), and the Azure
LuaLaTeX compiler. Local development authentication was used; this is not a signed-in
acceptance test of the Vercel preview or an iPad handwriting test.

## Verdict

PDF reading, explicit first-step suggestions, two adopted transformations, saving, and PDF
generation work after the PDF-side fixes. A complete, verified solution demo is **not yet
ready**: the existing CAS returns `DOMAIN_CHANGED` on the integral rewrite, and the next
antiderivative proposal is rejected as `IR_INVALID` because `\\arctan` is unsupported.
PR #67 is being revised by its author and has deliberately not been merged here.

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
- Latest main's report-formatting fixes were merged. No code from PR #67 was included.

## Actual live run after the fixes

1. Resources -> Add resource -> supplied PDF -> Choose a problem from this PDF.
2. Read problems with AI: the fraction, exponents and limits 1 and 2 matched the source.
3. Adopt as given lines -> Suggest next step, without handwriting an initial line:
   a real suggestion request was sent and the partial-fraction rewrite was offered.
4. The real CAS returned `unknown / DOMAIN_CHANGED`. The UI required explicit unverified
   adoption. The second proposal split the integral into three terms and was also unverified.
5. The next real AI proposal was the correct antiderivative with `\\arctan(x)`. The parser
   rejected `\\arctan`, so no further candidate could be adopted. This remains a PR #67
   dependency; it was not silently replaced with a different formula.
6. The notebook saved, and Export PDF -> LaTeX template (Azure) produced a two-page PDF:
   problem and adopted intermediate work, then the verification appendix. Both pages were
   rendered and visually inspected. The appendix identifies the adopted steps as unverified.

The local evidence PDF is `output/pdf/integral-live-validation.pdf` in the task workspace.
It contains **intermediate work**, not a completed solution.

## Regression checks and demo gate

- TypeScript: passed.
- Frontend unit tests: 273 passed, one pre-existing component-render test skipped.
- PDF problem-import browser tests: 11 passed, including the supplied integral worksheet.
- Real image transcription, real suggestions, real CAS responses and real PDF compilation:
  checked separately from the scripted browser tests.

Before presenting a complete solution, integrate the completed PR #67 through the team's
normal review process and repeat the live path. Require that the partial-fraction rewrite
is compared to the original integral, inverse tangent can be parsed/printed/checked, the
final exact answer matches the reference above, reopening preserves all lines and statuses,
and the final exported PDF includes the actual final answer without claiming unverified
steps are verified. Do not use the current intermediate PDF as evidence of a completed demo.
