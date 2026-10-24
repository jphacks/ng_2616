import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { segmentsFromSource, type Line, type Notebook, type Proof } from '@mn/contracts';
import { buildNotebook } from '../../src/core/presets';
import { inputHash, payloadForLine } from '../../src/core/cas/payload';

function fixture(): Notebook {
  const n = buildNotebook('integral', 'ja');
  n.title = 'PDF出力の検証：日本語・数式・修正履歴';
  n.problem.origin = { kind: 'pdf', name: '演習プリント_01.pdf', page: 2 };
  n.problem.independent_var = 'x';
  n.lines = [];
  const add = (formula: string, status: Proof['status'], extra: Partial<Line> = {}, ancestors: string[] = []) => {
    const l: Line = { id: `L${n.lines.length}`, version: 1, state: 'SETTLED', source: 'user', role: 'step', ink: [], segments: segmentsFromSource(formula, { functions: n.problem.functions }), ...extra };
    n.lines.push(l);
    const hash = inputHash(n, payloadForLine(n, l.id), 'test-cas');
    l.verified = { verification_id: `v${l.id}`, input_hash: hash, proof: { status, conditions: [], evidence: [], hints: [], segment_results: [], depends_on: [], depends_on_unverified: !!ancestors.length, unverified_ancestors: ancestors, input_hash: hash, mock: false, cas: { version: 'test-cas', rules_version: '2.0.0', elapsed_ms: 1, timed_out: false } } };
  };
  add('$a > 0$', 'none', { source: 'pdf', role: 'premise', document_origin: { name: '演習プリント_01.pdf', page: 2, has_unreadable: false } });
  add('$x = 3$', 'wrong', { state: 'SUPERSEDED', superseded_by: 'L2' });
  add('$I(a) = a^3 + a^2$', 'ok', { revision_of: 'L1', ai_origin: { candidate_id: 'c', mode: 'COMPLETE_RHS' } });
  add('$x = 2$', 'wrong');
  add('$x = 4$', 'unknown');
  add('$x^2 = 16$', 'ok', {}, ['L4']);
  add('$x = 5$', 'unknown', { source: 'ai', ai_origin: { candidate_id: 'c2', mode: 'NEXT_STEP', unverified_adoption: true } });
  add('$x = 6$', 'unknown', { segments: [{ type: 'math', expr: ['Unparsed', '<script>alert(1)</script> \\input{private}'], notation: 'plain', latex: 'do not execute' }] });
  add('$x = 7$', 'none', { segments: [{ type: 'text', text: '特殊文字：\\ { } $ & # ^ _ ~ %。これは解説の文章です。改行と日本語が正しく表示されることを確認します。\n' }] });
  add('$x = 8$', 'ok', { segments: [{ type: 'math', expr: ['Add', ...Array.from({ length: 12 }, (_, i) => ['Divide', ['Power', 'x', i + 1], ['Add', 'x', i + 1]] as import('@mn/contracts').MathJSON)], notation: 'plain', latex: 'ignored' }] });
  for (let i = 0; i < 12; i++) add('$x = 9$', i % 2 ? 'none' : 'ok', { segments: [{ type: 'text', text: `段落 ${i + 1}。` + '問題の条件を確認し、式の変形と検証結果を順番に記録します。'.repeat(18) }] });
  n.lines.push({ id: 'draft', version: 2, state: 'DRAFT', role: 'step', source: 'user', ink: [{ id: 's', points: [{ x: 1, y: 1, p: 1, t: 1 }] }], segments: [] });
  return n;
}

async function openFixture(page: import('@playwright/test').Page, notebook = fixture()) {
  page.on('console', (message) => { if (message.text().startsWith('[pdf-export]')) console.log(message.text()); });
  // PDF output works independently of CAS/network readiness; prevent downloading the runtime.
  await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await page.goto('/notebooks');
  await expect(page.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
  await page.evaluate(async (raw) => {
    const snapshot = JSON.parse(raw);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('mn_notebooks_00000000-0000-4000-8000-000000000001');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readwrite');
      tx.objectStore('notebooks').put({ id: snapshot.id, title: snapshot.title, updated_at: new Date().toISOString(), revision: 1, snapshot });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, JSON.stringify(notebook));
  await page.goto(`/notebooks/${notebook.id}`);
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible();
}

test('exports a real multipage PDF locally, preserving unsaved title and notebook contents', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'PDF出力の検証：日本語・数式・修正履歴', exact: true }).click();
  const title = page.locator('header input');
  await title.fill('未保存のPDF出力テスト');
  await title.press('Enter');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  const rowsBefore = await page.locator('[data-line-id]').count();
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await page.getByLabel('Name (optional)').fill('山田 太郎');
  await page.getByLabel('Student ID (optional)').fill('12345678');
  await page.getByRole('button', { name: 'Create report PDF' }).click();
  await expect(page.getByText('Your PDF is ready.').or(page.getByRole('dialog').getByRole('alert'))).toBeVisible({ timeout: 120000 });
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Your PDF is ready.')).toBeVisible();
  await expect(page.getByText(/1 unfinished lines/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('未保存のPDF出力テスト.pdf');
  const qa = process.env.PDF_QA_DIR ?? test.info().outputDir;
  await mkdir(qa, { recursive: true });
  const target = path.join(qa, 'notebook-export.pdf');
  await file.saveAs(target);
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(target);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(10000);
  const pageCount = await page.evaluate(async (data) => {
    const url = '/pdfjs/pdf.min.mjs';
    const pdfjs = await import(/* webpackIgnore: true */ url);
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: new Uint8Array(data) });
    const pdf = await task.promise;
    const count = pdf.numPages;
    // A syntactically valid PDF can still contain almost-blank page images. Render every
    // interior page of this dense fixture to detect missing text after rasterization.
    for (let i = 2; i < count; i++) {
      const p = await pdf.getPage(i);
      const viewport = p.getViewport({ scale: 0.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      await p.render({ canvas, canvasContext: ctx, viewport }).promise;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let j = 0; j < pixels.length; j += 4) if (pixels[j]! + pixels[j + 1]! + pixels[j + 2]! < 600) ink++;
      if (ink < 500) throw new Error(`PDF page ${i} lost its report content (${ink} ink pixels)`);
      canvas.width = 0; canvas.height = 0;
    }
    await task.destroy();
    return count;
  }, [...bytes]);
  expect(pageCount).toBeGreaterThan(1);
  expect(posts).toEqual([]);
  await page.getByRole('button', { name: 'close', exact: true }).last().click();
  await expect(page.locator('iframe[data-pdf-export]')).toHaveCount(0);
  expect(await page.locator('[data-line-id]').count()).toBe(rowsBefore);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
});

test('cancels without changing the notebook or leaving rendering frames', async ({ page }) => {
  await openFixture(page);
  const count = await page.locator('[data-line-id]').count();
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await page.getByRole('button', { name: 'Create report PDF' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('iframe[data-pdf-export]')).toHaveCount(0);
  expect(await page.locator('[data-line-id]').count()).toBe(count);
});

test('reports document limits and allows retry without saving or clearing ink', async ({ page }) => {
  const n = fixture();
  n.lines = Array.from({ length: 501 }, (_, i) => ({ ...n.lines[0]!, id: `line_${i}` }));
  await openFixture(page, n);
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await page.getByRole('button', { name: 'Create report PDF' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('too large');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('too large');
  await expect(page.getByRole('link', { name: 'Download PDF' })).toHaveCount(0);
});
