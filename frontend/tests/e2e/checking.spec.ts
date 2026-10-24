import { expect, test } from './fixtures';
import { inkPixels, mockRecognition, mockSuggestions, openPreset, rows, statusOf, writeAndConfirm } from './helpers';

test('a failed recognition keeps the ink, offers Retry and Back to ink', async ({ page }) => {
  await mockRecognition(page, [{ fail: 'IR_INVALID' }, '$x^2 + 1$']);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await expect(page.getByText('Could not read this line')).toBeVisible();
  expect(await inkPixels(rows(page).first())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(statusOf(page, 0)).toHaveAttribute('title', 'Starting line');
});

test('a read outside the parser grammar is kept as written and marked not checkable', async ({ page }) => {
  const latex = String.raw`\begin{pmatrix} 1 \\ 2 \end{pmatrix}`;
  await mockRecognition(page, [{ unparsed: latex }, '$x + 1$']);
  await mockSuggestions(page, []);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await expect(statusOf(page, 0)).toHaveAttribute('title', 'Not checkable · the checker cannot read this notation yet');
  await expect(page.getByText('Could not read this line')).toBeHidden();
  await expect(rows(page).first().locator('.katex')).toBeVisible();
  await writeAndConfirm(page);
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Not verified · the line above could not be checked');
});

test('Back to ink turns a failed line into an editable draft', async ({ page }) => {
  await mockRecognition(page, [{ fail: 'IR_INVALID' }]);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await page.getByRole('button', { name: 'Back to ink' }).click();
  await expect(page.getByRole('button', { name: 'Confirm' }).first()).toBeEnabled();
});

test('wrong step: category first, then evidence, hints, revision and recovery', async ({ page }) => {
  await mockRecognition(page, ['$(x-2)(x-3)$', '$= x^2 - 5x + 5$', '$= x^2 - 5x + 6$']);
  await mockSuggestions(page, []);
  await openPreset(page, /Expand a polynomial/);
  await writeAndConfirm(page);
  await expect(statusOf(page, 0)).toHaveAttribute('title', 'Starting line');
  await writeAndConfirm(page);
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Constant term');

  // completion is locked while a wrong line is unresolved
  await page.getByRole('button', { name: /Suggest next step/ }).click();
  await expect(page.getByText('Revise the line marked wrong')).toBeVisible();

  await statusOf(page, 1).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Constant term in line 2')).toBeVisible();
  await expect(sheet.getByText('Expected')).toBeHidden();
  await sheet.getByRole('button', { name: 'Show evidence' }).click();
  await expect(sheet.getByText('Expected')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Hint 2' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Hint 1' }).click();
  await expect(sheet.getByText('Check the term independent of the variable.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Hint 2' }).click();
  await expect(sheet.getByText('Match the constant part of line 1 to this line.')).toBeVisible();
  // hints never reveal the missing value
  await expect(sheet.getByText(/\+\s*6/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Revise this line' }).click();

  const revision = rows(page).filter({ hasText: 'Revision of line 2' });
  await expect(revision).toBeVisible();
  await writeAndConfirm(page, revision);
  await expect(page.getByText('Revision verified')).toBeVisible();
  await expect(page.getByText('Replaced by a revision')).toBeVisible();
  await expect(rows(page).getByRole('button', { name: 'Verified' })).toHaveCount(1);
});

test('completing a right-hand side: "1 + 1 =" → verified "1 + 1 = 2"', async ({ page }) => {
  await mockRecognition(page, ['$1 + 1 =$']);
  const calls = await mockSuggestions(page, ['$1 + 1 = 2$']);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await expect(statusOf(page, 0)).toHaveAttribute('title', /Not verified · incomplete/);
  await expect(page.getByText('Verified suggestion')).toBeVisible();
  expect(calls[0]).toMatchObject({ mode: 'COMPLETE_RHS' });
  // the model sees the incomplete line it has to complete
  expect(JSON.stringify(calls[0])).toContain('1 + 1 =');
  await page.keyboard.press('Tab');
  await expect(statusOf(page, 0)).toHaveAttribute('title', 'Verified');
});

test('a wrong suggestion is never offered; the checker rejection is explained', async ({ page }) => {
  await mockRecognition(page, ['$x^2 = 4$']);
  await mockSuggestions(page, ['$x = 2$', '$x = \\pm 2$']);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await expect(page.getByText('Checker rejected a suggestion')).toBeVisible();
  await expect(page.getByText('Verified suggestion')).toBeVisible();
  await page.getByText('Checker rejected a suggestion').click();
  await expect(page.getByRole('dialog').getByText('Missing solution', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Verified');
});

test('an unverified suggestion is amber and needs a second confirmation', async ({ page }) => {
  await mockRecognition(page, ['$x$']);
  await mockSuggestions(page, ['$= \\sum_{n=1}^{\\infty} \\frac{x}{n^2}$']);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await expect(page.getByText(/^Unverified ·/)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByText(/could not confirm this step/)).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press('Tab');
  await expect(rows(page)).toHaveCount(3);
  await expect(statusOf(page, 1)).toHaveAttribute('title', /Not verified/);
  await expect(rows(page).nth(1).getByText('AI', { exact: true })).toBeVisible();
});

test('Escape dismisses a suggestion without changing any line', async ({ page }) => {
  await mockRecognition(page, ['$x^2 = 4$']);
  await mockSuggestions(page, ['$x = \\pm 2$']);
  await openPreset(page, /New empty notebook/);
  await writeAndConfirm(page);
  await expect(page.getByText('Verified suggestion')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Verified suggestion')).toBeHidden();
  await expect(rows(page)).toHaveCount(2);
});

test('swiping a settled line left reveals its actions', async ({ page }) => {
  await mockRecognition(page, ['$(x-2)(x-3)$', '$= x^2 - 5x + 5$']);
  await mockSuggestions(page, []);
  await openPreset(page, /Expand a polynomial/);
  await writeAndConfirm(page);
  await writeAndConfirm(page);
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Constant term');
  const row = rows(page).nth(1);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6 - 260, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  const strip = row.locator('[aria-hidden="true"]').first();
  await expect(strip.getByText('Revise')).toBeInViewport();
  await strip.getByText('Details').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
