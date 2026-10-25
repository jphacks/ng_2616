# ADR 0007: Import PDF questions as ordinary notebook lines

Status: accepted, 2026-10-24 (follows ADR 0006).

PDF review retains page images, question selection, transcription edits and explicit premise
selection. Adoption inserts ordinary lines before the active draft, preserving existing line
order, ink and the notebook title. Readable problem formulas are given lines; prose is text.
Definitions retain their definition role. Unknowns and the independent variable are inferred
from formulas by the notebook, rather than stored in a separate problem card.

Premise candidates are removed from the default editable problem body and adopted only when
selected. This matters because v2.2 recognises assumption-shaped math on any line, independently
of its Given mark. Unsupported or unreadable formulas are retained as text with provenance and
cannot silently become executable assumptions. Explicit edits entered by the user are adopted
as their own content. No missing conditions are invented.

Each imported line stores the PDF filename/page in document_origin and the question label,
transcription method and edit/mock flags in extensions.pdf_question. Reading old problem-card
snapshots preserves their PDF provenance when migrating them to given lines.

One existing IMPORT_PDF history command inserts the whole group. Undo/Redo restores the group
without OCR requests. Changes to settled context invalidate an open import; additional draft
ink is permitted. Later verification is recalculated from the current given lines, and delayed
CAS results must still match their original input hash before settling.

Local PDF text extraction and preview stay in the browser. Explicit image transcription calls
Gemini through the existing Next.js direct gateway; Azure is not used.

## Review follow-up: resource entry and optional rereading

Problem adoption starts from a saved PDF in Resources, using "Choose a problem from this
PDF". The duplicate file-import action is removed from the notebook header. Adding a resource
retains its original file; selecting a problem and adopting given lines remain separate steps.

PDF previews observe their available width. Hidden tabs do not render at zero or negative
widths; showing the tab or resizing it triggers a repaint. Opening or rendering failures have
an explicit error state instead of an endless spinner.

Image rereading is a small, optional recovery action. Its result never overwrites the PDF text
reading. The student compares the alternatives and explicitly selects which to adopt; separate
edits survive switching between them. Differences in formulas in like-numbered questions are
flagged for review, without deciding which transcription is correct or replacing either symbol.
Discarding the AI alternative restores the original draft without another API request.
