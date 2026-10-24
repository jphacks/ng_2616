"""Exercise-sheet PDF import (spec §12.3, M-09), Stage 2: download from the signed Supabase Storage
URL (no redirects), verify size/SHA-256, validate with pypdf (<= 10 MiB, <= 5 pages, not encrypted),
render pages with pypdfium2 (<= 1000 px), transcribe with AI-P, never commit partial results."""
