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
