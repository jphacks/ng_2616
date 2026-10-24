import { expect, test } from '@playwright/test';
import { mockRecognition, mockSuggestions, openHome, openPreset, rows, statusOf, writeAndConfirm } from './helpers';

test('save, reload and reopen keep lines and verification', async ({ page }) => {
  await mockRecognition(page, ['$(x-2)(x-3)$', '$= x^2 - 5x + 6$']);
  await mockSuggestions(page, []);
  await openPreset(page, /Expansion/);
  await writeAndConfirm(page);
  await writeAndConfirm(page);
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Verified');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const url = page.url();

  await page.reload();
  await expect(page.getByText('Checker ready')).toBeVisible({ timeout: 120_000 });
  await expect(rows(page)).toHaveCount(3);
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Verified');

  await openHome(page);
  const item = page.getByRole('listitem').filter({ hasText: 'Expansion' });
  await expect(item).toHaveCount(1);
  await item.getByRole('button').first().click();
  await expect(page).toHaveURL(url);
});

test('a notebook can be deleted from the list', async ({ page }) => {
  await openPreset(page, /Solving an equation/);
  await openHome(page);
  page.on('dialog', (d) => void d.accept());
  const item = page.getByRole('listitem').filter({ hasText: 'Solving an equation' });
  await item.getByRole('button', { name: 'Delete' }).click();
  await expect(item).toHaveCount(0);
});

test('resources: upload a PDF, view pages, pin a textbook page, remove it', async ({ page, context }) => {
  const maker = await context.newPage();
  await maker.setContent(
    '<h1>Exercise 1</h1><p>Compute the integral of x squared from 0 to 1 and simplify the result carefully.</p>' +
      '<div style="page-break-after: always"></div><h1>Exercise 2</h1><p>Solve x squared equals four over the real numbers, keeping every solution.</p>',
  );
  const pdf = await maker.pdf({ format: 'A5' });
  await maker.close();

  await openPreset(page, /Untitled notebook/);
  await page.getByRole('tab', { name: 'Resources' }).click();
  await expect(page.getByText('Upload a problem sheet or textbook').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add resource' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'exercises.pdf', mimeType: 'application/pdf', buffer: pdf });
  await dialog.getByRole('button', { name: 'Textbook' }).click();
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('exercises.pdf').first()).toBeVisible();
  await expect(page.getByText('Textbook · 2 pages')).toBeVisible();
  await expect(page.locator('section canvas')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '2', exact: true }).click();
  await expect(page.getByText('Page 2')).toBeVisible();
  await page.getByRole('button', { name: 'Use this page as context' }).click();
  await expect(page.getByRole('button', { name: 'Used as context' })).toBeVisible();

  page.on('dialog', (d) => void d.accept());
  // no hover needed: on a tablet Remove is visible on the selected resource
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Upload a problem sheet or textbook').first()).toBeVisible();
});

test('the demo notebook comes with its problem sheet', async ({ page }) => {
  await openPreset(page, /Schrödinger/);
  await page.getByRole('tab', { name: 'Resources' }).click();
  await expect(page.getByText('Problem sheet 3: The Schrödinger equation')).toBeVisible();
});

test('language toggle switches to Japanese and back', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: '日本語' }).click();
  await expect(page.getByRole('heading', { name: '始め方を選んでください' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
});

test('iPad frame for demos rotates between landscape and portrait', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1300 });
  await openHome(page, '?frame=ipad');
  const rotate = page.getByRole('button', { name: 'Rotate' });
  await expect(rotate).toBeVisible();
  const frame = page.locator('div.rounded-\\[28px\\]');
  const landscape = (await frame.boundingBox())!;
  expect(landscape.width).toBeGreaterThan(landscape.height);
  await rotate.click();
  await expect.poll(async () => {
    const b = (await frame.boundingBox())!;
    return b.height > b.width;
  }).toBe(true);
});
