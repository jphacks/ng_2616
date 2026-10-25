import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeQuestionPage } from '@mn/contracts';
import { quadraticQuestionFixture } from '@mn/contracts/fixtures';
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

async function openImport(page: Page, buffer?: Buffer, review = true, readInitial = true) {
  await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('mn.locale', 'en'));
  await page.goto('/notebooks');
  await expect(page.getByRole('heading', { name: 'Start something new' })).toBeVisible();
  await page.getByRole('button', { name: /New empty notebook/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Resources', exact: true })).toBeVisible();
  const row = page.locator('[data-line-id]').last();
  await scribble(page, row);
  await expect.poll(() => inkPixels(row)).toBeGreaterThan(10);
  await page.getByRole('tab', { name: 'Resources', exact: true }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Add resource', exact: true }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'test_questioncard.pdf', mimeType: 'application/pdf', buffer: buffer ?? await worksheet(page) });
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click();
  if (!review) return page.getByRole('dialog');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose a problem from this PDF' }).click();
  if (readInitial) {
    const result = { ...quadraticQuestionFixture(), method: 'ai', mock: false };
    result.questions = result.questions.map((q) => ({ ...q, title: `Question ${q.label}` }));
    let initial = true;
    await page.route('**/api/v1/resources/questions', (route) => {
      if (!initial) return route.fallback();
      initial = false;
      return route.fulfill({ status: 202, json: { ok: true, request_id: 'initial-ai-fixture', data: { job: { state: 'succeeded', result } } } });
    });
    await page.getByRole('dialog').getByRole('button', { name: 'Read problems with AI', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Question', exact: true }).locator('option')).toHaveCount(11);
  }
  return page.getByRole('dialog');
}

test('real worksheet → scripted AI reading → ten questions → given lines, undo/redo and save/reopen', async ({ page }) => {
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
  const card = page.locator('main > div').first();
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
  expect(calls).toHaveLength(1);
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
  await dialog.getByRole('button', { name: 'Reread with AI (optional)' }).click();
  await expect(dialog.getByRole('radio', { name: 'Initial AI reading', exact: true })).toBeChecked();
  await dialog.getByRole('radio', { name: 'AI reread result', exact: true }).check();
  await expect(dialog.getByText('AI transcription of this page.', { exact: false })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Question', exact: true }).selectOption('q');
  const boxes = dialog.getByRole('checkbox');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect(boxes.nth(1)).toBeDisabled();
  await expect(boxes.nth(2)).toBeDisabled();
  await boxes.nth(0).check();
  await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
  const card = page.locator('main > div').first();
  await expect(card).toContainText('Parameterized problem');
  expect(input?.page).toBe(1); expect(input?.image.mime).toBe('image/jpeg');
  expect(input?.image.data.length).toBeGreaterThan(1000);
  expect(input?.text.length).toBeGreaterThan(60);
});

test('AI is required for adoption and a missing provider never falls back to broken PDF text', async ({ page }) => {
  await page.route('**/api/v1/resources/questions', (route) => route.fulfill({ status: 202, json: {
    ok: true, request_id: 'unconfigured', data: { job: { state: 'failed', error: { code: 'QUESTION_OCR_UNAVAILABLE', message: 'unconfigured' } } },
  } }));
  const dialog = await openImport(page, undefined, true, false);
  await expect(dialog.getByRole('combobox', { name: 'Question', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Adopt as given lines' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Read problems with AI', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('configured Gemini');
  await expect(dialog.getByRole('combobox', { name: 'Question', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Adopt as given lines' })).toBeDisabled();
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
  await dialog.getByRole('button', { name: 'Reread with AI (optional)' }).click();
  await requested;
  await expect(dialog.getByText('Transcribing this page…')).toBeVisible();
  await dialog.getByRole('button', { name: 'close', exact: true }).last().click();
  finish();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('main > div').first()).not.toContainText('test_questioncard.pdf');
  await expect.poll(() => inkPixels(page.locator('[data-line-id]').last())).toBeGreaterThan(10);
});

for (const [code, message] of [
  ['UPSTREAM_INVALID', 'AI service could not process'],
  ['UPSTREAM_TIMEOUT', 'timed out'],
  ['SCHEMA_INVALID', 'could not be validated'],
] as const) {
  test(`AI failure ${code} explains the problem and preserves the selected local question`, async ({ page }) => {
    await page.route('**/api/v1/resources/questions', (route) => route.fulfill({ status: 202, json: {
      ok: true, request_id: 'failure', data: { job: { state: 'failed', error: { code, message: 'provider failure', retryable: false } } },
    } }));
    const dialog = await openImport(page);
    const questions = dialog.getByRole('combobox', { name: 'Question', exact: true });
    await expect(questions.locator('option')).toHaveCount(11);
    await questions.selectOption({ label: 'Question 1' });
    const before = await dialog.getByLabel('Review / correct the transcription').inputValue();
    await dialog.getByRole('button', { name: 'Reread with AI (optional)' }).click();
    await expect(dialog.getByRole('alert')).toContainText(message);
    await expect(dialog.getByLabel('Review / correct the transcription')).toHaveValue(before);
    await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
    await expect(page.locator('main')).toContainText('Question 1');
    await expect.poll(() => inkPixels(page.locator('[data-line-id]').last())).toBeGreaterThan(10);
  });
}

test('corrupt and oversized files leave the notebook unchanged', async ({ page }) => {
  const dialog = await openImport(page, Buffer.from('%PDF-invalid'), false);
  await expect(dialog).toContainText('corrupted or encrypted');
  const pdf = await worksheet(page);
  await dialog.locator('input[type=file]').setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([pdf, Buffer.alloc(10 * 1024 * 1024 + 1 - pdf.length, 32)]) });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose a problem from this PDF' }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByRole('alert')).toContainText('10 MiB');
  await expect(review.getByRole('button', { name: 'Adopt as given lines' })).toBeDisabled();
  await expect.poll(() => inkPixels(page.locator('[data-line-id]').last())).toBeGreaterThan(10);
});

test('AI symbol changes stay separate and switching readings preserves edits without another request', async ({ page }) => {
  let calls = 0;
  const changed = normalizeQuestionPage({ complete: true,
    lines: [{ id: 'l', has_unreadable: false, segments: [{ type: 'math', content: '3x^2-15=0' }] }],
    questions: [{ id: 'q', label: '1', title: 'Question 1', line_ids: ['l'], unknowns: ['x'], independent_var: '', functions: [], premises: [] }],
  }, 1, 'ai');
  await page.route('**/api/v1/resources/questions', (route) => {
    calls++;
    return route.fulfill({ status: 202, json: { ok: true, request_id: 'changed', data: { job: { state: 'succeeded', result: changed } } } });
  });
  const dialog = await openImport(page);
  await dialog.getByRole('combobox', { name: 'Question', exact: true }).selectOption({ label: 'Question 1' });
  const editor = dialog.getByLabel('Review / correct the transcription');
  const original = await editor.inputValue();
  const edited = original + '\nMy correction';
  await editor.fill(edited);
  await dialog.getByRole('button', { name: 'Reread with AI (optional)' }).click();
  await expect(dialog.getByRole('alert')).toContainText('formulas differ');
  await dialog.getByRole('region', { name: 'Compare the readings' }).screenshot({ path: test.info().outputPath('ai-readings.png') });
  await expect(editor).toHaveValue(edited);
  await expect(dialog.getByRole('radio', { name: 'Initial AI reading', exact: true })).toBeChecked();
  await dialog.getByRole('radio', { name: 'AI reread result', exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Question', exact: true }).selectOption('q');
  await editor.fill('$3x^2-15=0$\nAI draft edit');
  await dialog.getByRole('radio', { name: 'Initial AI reading', exact: true }).check();
  await expect(editor).toHaveValue(edited);
  await dialog.getByRole('radio', { name: 'AI reread result', exact: true }).check();
  await expect(editor).toHaveValue('$3x^2-15=0$\nAI draft edit');
  await dialog.getByRole('button', { name: 'Discard the AI result' }).click();
  await expect(editor).toHaveValue(edited);
  await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
  await expect(page.locator('main > div').first()).toContainText('My correction');
  expect(calls).toBe(1);
});

test('one resource entry point and a rendered PDF survive closing, reopening and resizing', async ({ page }) => {
  const dialog = await openImport(page);
  await dialog.getByRole('button', { name: 'close', exact: true }).last().click();
  await expect(page.locator('header').getByRole('button', { name: /problem|PDF/i })).toHaveCount(1); // PDF export only
  await expect(page.getByRole('button', { name: 'Choose a problem from this PDF' })).toHaveCount(1);
  const pdfCanvas = page.locator('section canvas');
  const darkPixels = () => pdfCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 3] && bytes[i]! < 200 && bytes[i + 1]! < 200 && bytes[i + 2]! < 200) count++;
    return count;
  });
  await expect.poll(darkPixels).toBeGreaterThan(100);
  const url = page.url();
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await page.goto('/notebooks');
  await page.goto(url);
  await expect(page.getByRole('tab', { name: 'Canvas', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Resources', exact: true }).click();
  await expect.poll(darkPixels).toBeGreaterThan(100);
  const wide = await pdfCanvas.evaluate((c: HTMLCanvasElement) => c.width);
  await page.screenshot({ path: test.info().outputPath('resource-reopened.png') });
  await page.setViewportSize({ width: 850, height: 820 });
  await expect.poll(() => pdfCanvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeLessThan(wide);
  await expect.poll(darkPixels).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Choose a problem from this PDF' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Read problems with AI', exact: true })).toBeVisible();
});

test('integral worksheet keeps fraction structure and bounds through AI-only adoption', async ({ page }) => {
  const file = process.env.INTEGRAL_DEMO_PDF;
  let pdf: Buffer;
  if (file) pdf = await readFile(file);
  else {
    const maker = await page.context().newPage();
    await maker.setContent('<h1>Definite integral</h1><math display="block"><msubsup><mo>∫</mo><mn>1</mn><mn>2</mn></msubsup><mfrac><mrow><mn>3</mn><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>5</mn><mi>x</mi><mo>+</mo><mn>4</mn></mrow><mrow><mi>x</mi><mo>(</mo><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn><mo>)</mo></mrow></mfrac><mi>d</mi><mi>x</mi></math>');
    pdf = await maker.pdf({ format: 'A4' }); await maker.close();
  }
  const result = normalizeQuestionPage({ complete: true,
    lines: [{ id: 'l', has_unreadable: false, segments: [{ type: 'math', content: '\\int_1^2 \\frac{3x^2+5x+4}{x(x^2+1)}\\,dx' }] }],
    questions: [{ id: 'q', label: '', title: 'Integral', line_ids: ['l'], unknowns: [], independent_var: '', functions: [], premises: [] }],
  }, 1, 'ai');
  await page.route('**/api/v1/resources/questions', (route) => route.fulfill({ status: 202, json: { ok: true, request_id: 'integral', data: { job: { state: 'succeeded', result } } } }));
  const dialog = await openImport(page, pdf, true, false);
  await expect(dialog.getByRole('combobox', { name: 'Question', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Adopt as given lines' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Read problems with AI', exact: true }).click();
  const editor = dialog.getByLabel('Review / correct the transcription');
  await expect(editor).toHaveValue(/\\int_\{1\}\^\{2\}.*\\frac\{3 x\^\{2\} \+ 5 x \+ 4\}/);
  await dialog.getByRole('button', { name: 'Adopt as given lines' }).click();
  await expect(page.locator('main > div').first()).toContainText('Integral');
  await expect(page.locator('main > div').first().locator('.katex .mfrac')).toHaveCount(1);
});
