'use client';

import type { ReferenceExcerpt } from '@mn/contracts';
import { getPages, listResources } from './service';

const TOTAL = 9000;
const PER_PAGE = 3000;

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/\\?[a-z]{2,}|[぀-ヿ一-鿿]{2,}/g)) out.add(m[0].replace(/^\\/, ''));
  return out;
}

/**
 * Reference text for suggestions (spec §15.2): problem sheets and notes in full, textbooks by
 * pinned page ± 1, then pages that share symbols/words with the recent lines. ≤ 9000 chars total.
 * Which pages were used is not shown to the student (product decision), only logged.
 */
export async function buildReferences(ownerId: string, notebookId: string, recentText: string): Promise<ReferenceExcerpt[]> {
  const resources = await listResources(ownerId, notebookId);
  const out: ReferenceExcerpt[] = [];
  let budget = TOTAL;
  const take = (name: string, page: number, text: string) => {
    if (budget <= 0 || !text.trim()) return;
    const t = text.slice(0, Math.min(PER_PAGE, budget));
    budget -= t.length;
    out.push({ name, page, text: t });
  };
  const textbooks: { name: string; pinned?: number; pages: { page: number; text: string }[] }[] = [];
  for (const r of resources) {
    const pages = await getPages(ownerId, r.id);
    if (r.kind === 'textbook') textbooks.push({ name: r.name, pinned: r.pinned_page, pages });
    else for (const p of pages) take(r.name, p.page, p.text);
  }
  const recent = tokens(recentText);
  for (const tb of textbooks) {
    const used = new Set<number>();
    if (tb.pinned !== undefined) {
      for (const p of tb.pages.filter((p) => Math.abs(p.page - tb.pinned!) <= 1)) {
        take(tb.name, p.page, p.text);
        used.add(p.page);
      }
    }
    const scored = tb.pages
      .filter((p) => !used.has(p.page))
      .map((p) => {
        const tk = tokens(p.text);
        let score = 0;
        for (const t of recent) if (tk.has(t)) score += 1;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const { p } of scored) take(tb.name, p.page, p.text);
  }
  if (out.length) console.debug('[references]', out.map((r) => `${r.name} p.${r.page} (${r.text.length})`).join(', '));
  return out;
}
