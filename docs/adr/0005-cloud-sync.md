# ADR 0005: Supabase is the source of truth for notebooks, resources and settings

**Status:** accepted (supersedes the device-local parts of spec §4.3, §14.5 and §15.2 and of the
v2.1 "Resources tab is device-local" delta)

## Context
Stage 1 saved notebooks to `mn_notebooks` only when the student pressed Save, kept uploaded PDFs
and their page text in IndexedDB on one device, and kept the interface language in
localStorage. A notebook opened on another device had its lines but none of its sources; a missing
table made the app save silently to the device instead; sign-out deleted the only copy of
resources. With autosave, writing the whole snapshot (ink is most of it) every few seconds would
also cost several MB per save.

## Decision
- **Autosave replaces the Save button.** `core/persistence/autosave.ts` follows spec §14.5:
  device writes (the *outbox*, IndexedDB `mn_outbox_<owner>`) debounce 1 s and happen at least
  every 5 s; cloud writes debounce 3 s and happen at least every 15 s. One cloud save at a time;
  network/auth/server failures retry with backoff (2 s → 60 s) and on `online`; a conflict pauses
  cloud saves and offers Reload / Save as copy. Hiding the tab or leaving the notebook flushes;
  `pagehide` flushes the outbox. Ctrl/Cmd+S still saves at once.
- **Recovery never overwrites.** On open, an outbox entry based on the cloud's current revision
  resumes silently; one based on an older revision is saved as a separate copy
  (`core/persistence/outbox.ts`). Offline, the outbox copy opens and is sent later.
- **Ink is stored apart from the snapshot.** `mn_notebook_ink(notebook_id, hash, strokes)` holds
  each line's strokes by content hash; `mn_notebooks.ink_index` maps line → hash and
  `mn_notebooks.preview` holds what a notebook card draws. A save is one RPC,
  `mn_save_notebook`, which checks the revision, inserts only the ink the server lacks, verifies
  every referenced hash exists and drops unreferenced ink in the same transaction. It is
  `SECURITY INVOKER`, so RLS and the 0001 guard trigger apply unchanged. Rows saved before this
  ADR (`ink_index` null) still open; their first save converts them.
- **Resources live in Supabase.** `mn_resources` + `mn_resource_pages` (text, OCR state,
  thumbnail path) and the private bucket `mn-resources` with paths
  `<owner>/<notebook>/<resource>/source.<ext>` and `thumb-<page>.png`. Storage policies require the
  first path segment to be `auth.uid()` and the second an owned notebook; there is no UPDATE
  policy (`upsert=false`). Extraction and OCR rendering stay in the browser (pdf.js); IndexedDB
  is a cache plus a queue for what has not reached the cloud (offline imports, pending uploads,
  OCR text). Quotas: 30 MiB per file, 20 resources per notebook, 500 MiB per user.
- **Account settings sync.** `mn_user_settings(locale, prefs)` holds the interface language and
  the notebook list order/sort; localStorage remains the first-paint cache; last write wins.
  Device-only choices (pen/touch input mode, the iPad frame) stay in localStorage.
- **No silent device fallback.** A missing migration is an error, not a switch to device storage.
  Notebooks an older build kept on the device are uploaded once from the notebook list (a
  conflicting id becomes a copy). The dev bypass still keeps everything on the device.
- **Sign-out** first sends open notebooks, the outbox, pending resources and settings, then clears
  this user's device data as before.

## Consequences
- Deleting a resource or notebook removes its Storage files from the client first (row deletes do
  not delete objects). `supabase/functions/mn-storage-sweeper` removes files left behind
  (notebook deleted while offline, account deleted, abandoned uploads); schedule it daily.
- Two tabs editing the same notebook conflict on the second save and see the conflict actions;
  live multi-device editing (Supabase Realtime) is out of scope.
- Uploads use a single request (Storage standard upload, ≤ 30 MiB). Resumable TUS uploads can
  replace it without schema changes.
- The project needs migration `0002_mn_cloud_sync.sql` before this build is deployed.
