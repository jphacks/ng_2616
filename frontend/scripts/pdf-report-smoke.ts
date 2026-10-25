/** Generate a reproducible Japanese homework report for real LuaLaTeX smoke testing. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { segmentsFromSource, type Line } from '@mn/contracts';
import { buildNotebook } from '../src/core/presets';
import { serializeNotebook } from '../src/core/export/document';
import { serializeLatex } from '../src/core/export/latex';

async function main() {
const notebook = buildNotebook('integral', 'ja');
notebook.lines = [
  { role: 'premise', source: '$a > 0$' },
  { role: 'text', source: '与えられた積分を計算する。置換積分を用いて式を整理する。' },
  { role: 'step', source: '$I = \\int_0^1 x^2 \\, dx$' },
  { role: 'step', source: '$I = \\frac{1}{3}$' },
  { role: 'text', source: '以上より積分の値が求められた。特殊文字も本文として出力する： & # % _ \\input{secret}' },
].map((v, i) => ({ id: `report-${i}`, version: 1, state: 'SETTLED', role: v.role, source: 'user', ink: [], segments: v.role === 'text' ? [{ type: 'text', text: v.source }] : segmentsFromSource(v.source) } as Line));
const report = { title: '数理物理学・積分の課題レポート', author: '山田 太郎（表示例）', studentId: '12345678', homework: {
  course: 'Mathematical Physics I', institution: 'Example University', date: 'October 25, 2026', exercise: '2', paper: 'letter' as const, include_records: true,
} };
const folder = resolve(process.argv[2] ?? '../tmp/pdfs/latex-report');
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, 'report.tex'), serializeLatex(serializeNotebook(notebook, 'ja', report).document));
await writeFile(resolve(folder, 'request.json'), JSON.stringify({ notebook, language: 'ja', report }));
console.log(`Report smoke input: ${folder}`);
}
void main();
