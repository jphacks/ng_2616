import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeQuestionPage } from '@mn/contracts';
import { inkPixels, scribble } from './helpers';

async function worksheet(page: Page): Promise<Buffer> {
  const supplied = process.env.QUESTION_CARD_TEST_PDF ?? path.resolve(__dirname, '../../../../test_questioncard.pdf');
  if (existsSync(supplied)) return readFile(supplied);
  // CI builds an equivalent mathematical fixture; the user's local PDF need not be published.
  const maker = await page.context().newPage();
  const equations = ['3χ<sup>2</sup>−15=0', '(χ+7)<sup>2</sup>−18=0', 'χ<sup>2</sup>+10χ+24=0', 'χ<sup>2</sup>−12χ+35=0', 'χ<sup>2</sup>−χ−72=0', 'χ<sup>2</sup>+19χ=0', 'χ<sup>2</sup>−18χ+81=0', '3χ<sup>2</sup>+9χ+2=0', 'χ<sup>2</sup>−3χ+1=0', 'χ<sup>2</sup>−6χ+2=0'];
  await maker.setContent(`<style>body{font:18px serif}.grid{display:grid;grid-template-columns:1fr 1fr;gap:80px 35px}sup{font-size:65%}</style><h1>Quadratic equations</h1><p>Solve each equation.</p><div class="grid">${equations.map((e, i) => `<div>(${i + 1}) ${e}</div>`).join('')}</div>`);
  const pdf = await maker.pdf({ format: 'A4' }); await maker.close();
  return pdf;
}

async function openImport(page: Page, buffer?: Buffer) {
  await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await page.goto('/notebooks');
  await expect(page.getByRole('heading', { name: 'Start something new' })).toBeVisible();
  await page.getByRole('button', { name: /New empty notebook/ }).first().click();
  await expect(page.getByRole('button', { name: 'Import problem PDF' })).toBeVisible();
  const row = page.locator('[data-line-id]').last();
  await scribble(page, row);
  await expect.poll(() => inkPixels(row)).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Import problem PDF' }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'test_questioncard.pdf', mimeType: 'application/pdf', buffer: buffer ?? await worksheet(page) });
  return page.getByRole('dialog');
}

test('real worksheet → ten questions → given lines, undo/redo and save/reopen, without AI calls', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/resources/questions')) calls.push(r.url()); });
  const dialog = await openImport(page);
  const questions = dialog.getByRole('combobox', { name: 'Question', exact: true });
  await expect(questions.locator('option')).toHaveCount(11);
  await questions.selectOption({ label: 'Question 1' });
  await expect(dialog.getByLabel('Review / correct the transcription')).toHaveValue(/\\chi\^\{2\}/);
  await expect(dialog.getByText('No additional premises adopted.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator('main');
  await expect(card).toContainText('test_questioncard.pdf');
  await expect(card).toContainText('Question 1');
  await expect.poll(() => inkPixels(page.locator('[data-line-id]').last())).toBeGreaterThan(10);
  await page.keyboard.press('Control+z');
  await expect(card).not.toContainText('test_questioncard.pdf');
  await page.keyboard.press('Control+y');
  await expect(card).toContainText('test_questioncard.pdf');
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(card).toContainText('test_questioncard.pdf');
  await expect.poll(() => inkPixels(page.locator('[data-line-id]').last())).toBeGreaterThan(10);
  expect(calls).toEqual([]);
});

const aiPage = () => normalizeQuestionPage({
  complete: true,
  lines: [{ id: 'condition', has_unreadable: false, segments: [{ type: 'math', content: 'a>0' }] }, { id: 'unreadable', has_unreadable: true, segments: [{ type: 'math', content: 'b>\\square' }] }, { id: 'problem', has_unreadable: false, segments: [{ type: 'text', content: 'Solve' }, { type: 'math', content: 'x^2=a' }] }],
  questions: [{ id: 'q', label: 'A', title: 'Parameterized problem', line_ids: ['condition', 'unreadable', 'problem'], unknowns: ['x'], independent_var: '', functions: [], premises: [{ id: 'positive', kind: 'assumption', latex: 'a>0', source_line_ids: ['condition'] }, { id: 'unclear', kind: 'condition', latex: 'b>\\square', source_line_ids: ['unreadable'] }, { id: 'invented', kind: 'condition', latex: 'a<0', source_line_ids: ['condition'] }] }],
}, 1, 'ai');

test('explicit page AI path reviews a grounded premise and isolates unreadable/invented candidates', async ({ page }) => {
  let input: { page: number; image: { mime: string; data: string }; text: string } | undefined;
  await page.route('**/api/v1/resources/questions', async (route) => {
    const body = route.request().postDataJSON(); input = body.input;
    expect(Buffer.byteLength(route.request().postData()!)).toBeLessThan(2 * 1024 * 1024);
    await route.fulfill({ status: 202, json: { ok: true, request_id: crypto.randomUUID(), data: { job: { id: crypto.randomUUID(), state: 'succeeded', result: aiPage() } } } });
  });
  const dialog = await openImport(page);
  await expect(dialog.getByRole('combobox', { name: 'Question', exact: true }).locator('option')).toHaveCount(11);
  await dialog.getByRole('button', { name: 'Transcribe this page with AI' }).click();
  await expect(dialog.getByText('AI transcription of this page.', { exact: false })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Question', exact: true }).selectOption('q');
  const boxes = dialog.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeDisabled();
  await expect(boxes.nth(2)).toBeDisabled();
  await boxes.nth(0).check();
  await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
  const card = page.locator('main');
  await expect(card).toContainText('Parameterized problem');
  expect(input?.page).toBe(1); expect(input?.image.mime).toBe('image/jpeg');
  expect(input?.image.data.length).toBeGreaterThan(1000);
  expect(input?.text.length).toBeGreaterThan(60);
});

test('unconfigured image OCR reports an error once and keeps local extraction usable', async ({ page }) => {
  const dialog = await openImport(page);
  await expect(dialog.getByRole('combobox', { name: 'Question', exact: true }).locator('option')).toHaveCount(11);
  await dialog.getByRole('button', { name: 'Transcribe this page with AI' }).click();
  await expect(dialog.getByRole('alert')).toContainText('configured Gemini');
  await dialog.getByRole('combobox', { name: 'Question', exact: true }).selectOption({ label: 'Question 10' });
  await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
  await expect(page.locator('main')).toContainText('Question 10');
});

test('closing a pending transcription discards its late result and retains the existing card/ink', async ({ page }) => {
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  await page.route('**/api/v1/resources/questions', async (route) => {
    await gate;
    await route.fulfill({ status: 202, json: { ok: true, request_id: 'late', data: { job: { state: 'succeeded', result: aiPage() } } } }).catch(() => undefined);
  });
  const dialog = await openImport(page);
  await expect(dialog.getByRole('combobox', { name: 'Question', exact: true }).locator('option')).toHaveCount(11);
  const requested = page.waitForRequest('**/api/v1/resources/questions');
  await dialog.getByRole('button', { name: 'Transcribe this page with AI' }).click();
  await requested;
  await expect(dialog.getByText('Transcribing this page…')).toBeVisible();
  await dialog.getByRole('button', { name: 'close', exact: true }).last().click();
  finish();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('test_questioncard.pdf');
  await expect.poll(() => inkPixels(page.locator('[data-line-id]').last())).toBeGreaterThan(10);
});

test('corrupt and oversized files leave the notebook unchanged', async ({ page }) => {
  const dialog = await openImport(page, Buffer.from('%PDF-invalid'));
  await expect(dialog.getByRole('alert')).toContainText('readable PDF');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(dialog.getByRole('alert')).toContainText('10 MiB');
  await expect(dialog.getByRole('button', { name: 'Adopt as given lines' })).toBeDisabled();
});
