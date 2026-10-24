import { inferredUnknowns, normalizeQuestionPage, type QuestionPage, type QuestionPageWire, type UiLang } from '@mn/contracts';
import { parseMathLatex } from '@mn/contracts/ir';

export interface PdfTextItem { str: string; width: number; height: number; transform: number[] }

/** Reconstruct reading rows while keeping separate columns and raised exponent digits. */
export function positionedPdfLines(items: PdfTextItem[]): string[] {
  const rows: { y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of [...items].filter((i) => i.str.trim()).sort((a, b) => b.transform[5]! - a.transform[5]! || a.transform[4]! - b.transform[4]!)) {
    const y = item.transform[5]!;
    const height = item.height || Math.abs(item.transform[3]!) || 12;
    const row = rows.find((r) => Math.abs(r.y - y) <= Math.max(r.height, height) * 0.65);
    if (row) {
      row.items.push(item);
      if (height > row.height) { row.y = y; row.height = height; }
    } else rows.push({ y, height, items: [item] });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => {
    let previousEnd = 0;
    return r.items.sort((a, b) => a.transform[4]! - b.transform[4]!).map((item, i) => {
      const gap = i && item.transform[4]! - previousEnd > r.height * 0.8 ? '  ' : '';
      previousEnd = item.transform[4]! + item.width;
      const raised = item.height < r.height * 0.88 && item.transform[5]! > r.y + r.height * 0.15 && /^[0-9０-９]+$/.test(item.str.trim());
      return gap + (raised ? `^{${item.str.trim().normalize('NFKC')}}` : item.str);
    }).join('').trim();
  });
}

function normalizedMath(value: string): string {
  const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return value.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (digits) => `^{${Array.from(digits).map((c) => superscripts.indexOf(c)).join('')}}`).normalize('NFKC').replace(/[−－]/g, '-');
}

/** Conservative device-local path. No solving, invented conditions, or chi→x substitution. */
export function questionPageFromText(rawLines: string[], page: number, lang: UiLang): QuestionPage {
  const sourceLines = rawLines.filter((l) => l.trim()).slice(0, 100);
  const wire: QuestionPageWire = { complete: true, lines: [], questions: [] };
  const instructions: string[] = [];
  let lastQuestion: QuestionPageWire['questions'][number] | undefined;
  const addLine = (content: string) => {
    const normalized = normalizedMath(content);
    const parsed = parseMathLatex(normalized);
    const id = `p${page}_L${wire.lines.length + 1}`;
    const math = parsed.ok || (!/[\u3040-\u30ff\u4e00-\u9fff]/u.test(content) && /[=<>]/.test(normalized));
    wire.lines.push({ id, has_unreadable: /\[\?\]|□/.test(content), segments: [{ type: math ? 'math' : 'text', content: math ? normalized : content }] });
    return id;
  };
  for (const raw of sourceLines) {
    const normalized = normalizedMath(raw);
    const matches = [...normalized.matchAll(/\((\d{1,2})\)/g)];
    // Parenthesized numbers only count as labels at the row start or after a completed formula.
    const labels = matches.filter((m, i) => i === 0 ? m.index === 0 : /\s{2,}$/.test(normalized.slice(0, m.index)) && /[=<>]/.test(normalized.slice(matches[i - 1]!.index!, m.index)) && !/[=+\-*/]\s*$/.test(normalized.slice(0, m.index)));
    if (labels.length) {
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]![1]!;
        const start = labels[i]!.index! + labels[i]![0].length;
        const content = normalized.slice(start, labels[i + 1]?.index ?? normalized.length).trim();
        if (!content) continue;
        const lineId = addLine(content);
        lastQuestion = { id: `p${page}_Q${wire.questions.length + 1}`, label, title: lang === 'ja' ? `問 ${label}` : `Question ${label}`, line_ids: [...instructions, lineId], unknowns: [], independent_var: '', functions: [], premises: [] };
        wire.questions.push(lastQuestion);
      }
    } else {
      const id = addLine(raw);
      if (!wire.questions.length && /解き|求め|計算|示し|solve|find|evaluate|calculate/i.test(raw)) instructions.push(id);
      else if (lastQuestion && !/^\s*(組|番|名前)/.test(raw)) lastQuestion.line_ids.push(id);
    }
  }
  if (!wire.lines.length) wire.lines.push({ id: `p${page}_empty`, segments: [{ type: 'text', content: lang === 'ja' ? 'テキスト情報がありません。' : 'No text layer.' }], has_unreadable: true });
  if (rawLines.length > 100 || wire.questions.length > 20) throw new Error('QUESTION_PAGE_TOO_COMPLEX');
  // Without numbered questions, offer the readable page as a whole for explicit review.
  if (!wire.questions.length && wire.lines.length <= 32 && wire.lines.some((l) => l.segments.some((s) => s.type === 'math'))) wire.questions.push({ id: `p${page}_Q1`, label: '', title: lang === 'ja' ? 'ページ全体' : 'Whole page', line_ids: wire.lines.map((l) => l.id), unknowns: [], independent_var: '', functions: [], premises: [] });
  const result = normalizeQuestionPage(wire, page, 'text');
  for (const question of result.questions) question.unknowns = inferredUnknowns(result.lines.filter((l) => question.line_ids.includes(l.id)).flatMap((l) => l.segments));
  return result;
}
