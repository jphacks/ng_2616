import { expect, test } from '@playwright/test';
import { mockRecognition, mockSuggestions, openHome, openPreset, rows, statusOf, writeAndConfirm } from './helpers';

test('autosave, reload and reopen keep lines and verification', async ({ page }) => {
  await mockRecognition(page, ['$(x-2)(x-3)$', '$= x^2 - 5x + 6$']);
  await mockSuggestions(page, []);
  await openPreset(page, /Expansion/);
  await writeAndConfirm(page);
  await writeAndConfirm(page);
  await expect(statusOf(page, 1)).toHaveAttribute('title', 'Verified');
  // no Save button: the edits reach storage on their own within a few seconds
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });
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

test('edits made just before a reload are recovered from the device outbox', async ({ page }) => {
  await mockRecognition(page, ['$(x-2)(x-3)$']);
  await mockSuggestions(page, []);
  await openPreset(page, /Expansion/);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });
  await writeAndConfirm(page);
  await expect(statusOf(page, 0)).toHaveAttribute('title', /./);
  // reload before the 3 s cloud debounce: pagehide writes the outbox, the next open resumes it
  await page.reload();
  await expect(page.getByText('Checker ready')).toBeVisible({ timeout: 120_000 });
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 20_000 });
});

test('a notebook can be deleted from the list, and the delete undone first', async ({ page }) => {
  await openPreset(page, /Solving an equation/);
  await openHome(page);
  const item = page.getByRole('listitem').filter({ hasText: 'Solving an equation' });
  await expect(item).toHaveCount(1);

  await item.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(item).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(item).toHaveCount(1);

  await item.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('status')).toContainText('Deleted');
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
  await expect(item).toHaveCount(0);
});

test('a notebook can be renamed from its card menu', async ({ page }) => {
  await openPreset(page, /Definite integral/);
  await openHome(page);
  const item = page.getByRole('listitem').filter({ hasText: 'Definite integral' }).first();
  await item.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Area under a parabola');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Area under a parabola' })).toHaveCount(1);
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

test('language toggle in the account menu switches to Japanese and back', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitemradio', { name: '日本語' }).click();
  await expect(page.getByRole('heading', { name: '始め方を選んでください' })).toBeVisible();
  await page.getByRole('button', { name: 'アカウント' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
});

test('settings page switches finger input and keeps it after reload', async ({ page }) => {
  await openHome(page);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('radio', { name: /Pen only/ }).check({ force: true });
  await page.reload();
  await expect(page.getByRole('radio', { name: /Pen only/ })).toBeChecked();
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

test('holding a card (touch or mouse) opens its menu; holding and moving reorders the cards', async ({ page }) => {
  await openPreset(page, /Expansion/);
  await openPreset(page, /Solving an equation/);
  await openHome(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const cards = page.getByRole('listitem');
  const titles = () => cards.locator('span.line-clamp-2').allTextContents();
  const [first, second] = await titles();

  const a = (await cards.nth(0).boundingBox())!;
  await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
  await page.waitForTimeout(700);
  await touch('touchEnd');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeHidden();

  // a mouse hold behaves the same, and releasing it does not open the notebook
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page).toHaveURL(/\/notebooks$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeHidden();

  const b = (await cards.nth(1).boundingBox())!;
  await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
  await page.waitForTimeout(700);
  for (let i = 1; i <= 12; i++) await touch('touchMove', a.x + a.width / 2 + ((b.x - a.x) * i) / 12, a.y + a.height / 2 + ((b.y - a.y) * i) / 12);
  await page.waitForTimeout(300);
  await touch('touchEnd');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeHidden();
  await expect.poll(titles).toEqual(expect.arrayContaining([second, first]));
  expect((await titles()).slice(0, 2)).toEqual([second, first]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
  await expect.poll(async () => (await titles()).slice(0, 2)).toEqual([second, first]);
});
