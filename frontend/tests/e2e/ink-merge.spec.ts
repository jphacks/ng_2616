import { expect, test, type Locator } from '@playwright/test';
import { draw, inkPixels, rows } from './helpers';

test.beforeEach(async ({ page }) => {
  // Ink and device preferences must work even when CAS cannot be downloaded.
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.goto('/notebooks');
  await expect(page.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
  await expect(page.getByText('v-ink-map-1024', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Untitled notebook/ }).first().click();
  await expect(rows(page)).toHaveCount(1);
});

test('native listeners draw live ink before pointerup and after resizing', async ({ page }) => {
  const row = rows(page).last();
  await expect(page.getByText('v-ink-map-1024', { exact: true })).toBeVisible();
  for (const width of [1180, 980]) {
    await page.setViewportSize({ width, height: 820 });
    const canvas = row.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + 40, box!.y + 45);
    await page.mouse.down();
    await page.mouse.move(box!.x + 110, box!.y + 100, { steps: 8 });
    await expect.poll(() => inkPixels(row)).toBeGreaterThan(50);
    await page.mouse.up();
  }
  await expect(row.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
});

test('rapid strokes survive erasing, undo and clearing', async ({ page }) => {
  const row = rows(page).last();
  for (let i = 0; i < 8; i++) await draw(page, row, [[[35 + i * 35, 40], [35 + i * 35, 110]]]);
  await expect.poll(() => inkPixels(row)).toBeGreaterThan(1000);
  const before = await inkPixels(row);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await draw(page, row, [[[20, 75], [50, 75]]]);
  await expect.poll(() => inkPixels(row)).toBeLessThan(before);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(row)).toBe(before);
  await page.getByRole('button', { name: 'Clear line', exact: true }).click();
  await expect.poll(() => inkPixels(row)).toBe(0);
});

test('overlapping pointer lifetimes keep both strokes', async ({ page }) => {
  const row = rows(page).last();
  await row.locator('canvas').evaluate((canvas) => {
    const box = canvas.getBoundingClientRect();
    const send = (type: string, id: number, x: number, y: number) => {
      const target = type === 'pointerdown' ? canvas : window;
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: id, pressure: 0.5, clientX: box.x + x, clientY: box.y + y }));
    };
    send('pointerdown', 201, 60, 40);
    send('pointerdown', 202, 200, 40);
    send('pointermove', 201, 60, 110);
    send('pointermove', 202, 200, 110);
    send('pointerup', 201, 60, 110);
    send('pointerup', 202, 200, 110);
  });
  await expect.poll(() => inkPixels(row)).toBeGreaterThan(400);
  // Undo removes only the second stroke; another Undo removes the first.
  const both = await inkPixels(row);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(row)).toBeLessThan(both);
  expect(await inkPixels(row)).toBeGreaterThan(100);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(row)).toBe(0);
});

async function pointerStroke(row: Locator, pointerType: 'pen' | 'touch', pointerId: number, x: number) {
  await row.locator('canvas').evaluate((canvas, args) => {
    const box = canvas.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, pointerId: args.pointerId, pointerType: args.pointerType, pressure: 0.5, clientX: box.x + args.x, clientY: box.y + 40 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: box.y + 100 }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...init, clientY: box.y + 100, pressure: 0 }));
  }, { pointerType, pointerId, x });
}

for (const mode of ['auto', 'pen', 'touch'] as const) {
  test(`${mode} input mode is preserved with native pointer listeners`, async ({ page }) => {
    await page.evaluate((value) => localStorage.setItem('mn.inputMode', value), mode);
    await page.reload();
    const row = rows(page).last();
    await expect(row.locator('canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
    // Let the persisted preference hydrate before dispatching input.
    await page.waitForLoadState('networkidle');
    await pointerStroke(row, 'touch', 101, 40);
    if (mode === 'pen') await expect.poll(() => inkPixels(row)).toBe(0);
    else await expect.poll(() => inkPixels(row)).toBeGreaterThan(50);
    await pointerStroke(row, 'pen', 102, 140);
    await expect.poll(() => inkPixels(row)).toBeGreaterThan(50);
    const afterPen = await inkPixels(row);
    await pointerStroke(row, 'touch', 103, 240);
    if (mode === 'touch') await expect.poll(() => inkPixels(row)).toBeGreaterThan(afterPen);
    else await expect.poll(() => inkPixels(row)).toBe(afterPen);
  });
}
