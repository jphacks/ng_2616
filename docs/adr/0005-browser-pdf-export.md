# ADR 0005: Device-local PDF export in the current prototype

**Status:** accepted (2026-10-24, user-directed change).

## Decision

The current product exports a PDF entirely in the browser, using the existing KaTeX renderer,
html-to-image and jsPDF. It does not call Azure, a PDF API, an LLM or a LuaLaTeX compiler.
This supersedes the v2.0 M-10 runtime design (`.tex` download) and the interim proposal to compile
with LuaLaTeX on a server. Browser-based LuaLaTeX and optional `.tex` download remain future work.

The notebook's **Export PDF** button captures the current unsaved snapshot without saving or
changing history. A small form supplies a report title and optional name/student ID; it does not
change the notebook title. A separate submission-style document includes the problem, adopted assumptions, definitions,
ordered derivation, current verification annotations, provenance, omitted-draft notices and a
revision-history appendix. It never exports ink, hints or unadopted suggestions. Stale proofs are
labelled unverified; PDF generation does not perform a new mathematical check. Scripted/mock and
explicitly unverified AI adoption remain labelled.

The pure document serializer regenerates math from validated IR, ignores cached display LaTeX,
and treats `Unparsed` and prose as literal text. KaTeX runs with `trust:false`. Rendering occurs in
a temporary, off-screen document with local styles/fonts and no notebook-supplied HTML. Long
paragraphs are divided before pagination, formulas shrink to page width, and pages are rasterized
one at a time at 2× resolution. Each page has an A4 layout, margins and page numbers.

The first release stores body text and math as **images**, so PDF text selection/search and vector
math are unavailable. The UI explains this tradeoff. The downloadable Blob stays in memory until
the panel closes; no notebook contents are uploaded. Application chunks, styles and fonts can
still load as ordinary same-origin static assets.

## Limits and failure handling

- At most 500 notebook lines, 50 rendered pages, and a 30 MiB final PDF.
- Abort on panel close or notebook unmount; release temporary DOM/canvases and Blob URLs.
- A failed export shows a retry action and leaves the notebook unchanged.
- The completed PDF has an explicit download link, including on touch devices.
- The document description is deterministic; PDF bytes are not promised identical across runs or
  devices because metadata and installed Japanese fonts may differ.

## Verification

Unit tests cover status/provenance, stale context, revisions/drafts, unsupported math, IR limits,
snapshot preservation, safe filenames and lossless paragraph splitting. Browser tests generate a
real multipage PDF without export API calls, verify unsaved content, cancellation and limits.
Generated PDFs also require visual review for Japanese glyphs, formulas and pagination. Physical
iPad/Safari verification remains a device acceptance check; desktop Chromium alone is insufficient.
