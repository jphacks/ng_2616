import { LineSchema, type Notebook, type Segment, type Status, type Stroke } from '@mn/contracts';

/** How many leading lines a notebook card draws. */
export const PREVIEW_LINES = 3;

export interface PreviewLine {
  segments: Segment[];
  ink: Stroke[];
  status?: Status;
}

/** The top of a notebook's first page, enough to draw its card thumbnail. */
export interface NotebookPreview {
  lines: PreviewLine[];
}

function previewLine(raw: unknown): PreviewLine | null {
  const r = LineSchema.safeParse(raw);
  if (!r.success || r.data.state === 'SUPERSEDED') return null;
  return { segments: r.data.segments, ink: r.data.ink, status: r.data.verified?.proof.status };
}

/** Builds a preview from a full notebook, or from the few leading lines the cloud list selects. */
export function buildPreview(lines: readonly unknown[]): NotebookPreview {
  return {
    lines: lines
      .map(previewLine)
      .filter((l): l is PreviewLine => l !== null)
      .slice(0, PREVIEW_LINES),
  };
}

export const previewOf = (nb: Notebook) => buildPreview(nb.lines.slice(0, PREVIEW_LINES + 2));
