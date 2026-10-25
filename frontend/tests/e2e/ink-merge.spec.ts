import { expect, test, type Locator } from '@playwright/test';
import { draw, inkPixels, rows } from './helpers';

test.beforeEach(async ({ page }) => {
  // Ink and device preferences must work even when CAS cannot be downloaded.
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
  await page.goto('/notebooks');
  await expect(page.getByRole('heading', { name: 'Start something new' })).toBeVisible();
  await page.getByRole('button', { name: /New empty notebook/ }).first().click();
  await expect(rows(page)).toHaveCount(1);
});

test('native listeners draw live ink before pointerup and after resizing', async ({ page }) => {
  const row = rows(page).last();
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

test('main touch undo/redo gestures still work with native ink listeners', async ({ page }) => {
  const row = rows(page).first();
  await draw(page, row, [[[100, 60], [180, 60]]]);
  const before = await inkPixels(row);
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const tap = async (n: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: Array.from({ length: n }, (_, i) => ({ x: box.x + 300 + i * 60, y: box.y + 60, id: i })) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap(2);
  await expect.poll(() => inkPixels(row)).toBe(0);
  await tap(3);
  await expect.poll(() => inkPixels(row)).toBe(before);
});

test('main scratch-to-erase still removes ink and Undo restores it', async ({ page }) => {
  const row = rows(page).first();
  await draw(page, row, [[[100, 60], [180, 60]]]);
  const before = await inkPixels(row);
  // Main distinguishes a deliberate scratch (>=250ms) from fast handwriting.
  // Give the sampled gesture explicit timestamps so machine speed cannot change its meaning.
  await row.locator('canvas').evaluate(canvas => {
    const box = canvas.getBoundingClientRect(); const t0 = performance.now();
    const send = (type: string, x: number, y: number, elapsed: number) => {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 501, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, clientX: box.x + x, clientY: box.y + y });
      Object.defineProperty(event, 'timeStamp', { value: t0 + elapsed });
      (type === 'pointerdown' ? canvas : window).dispatchEvent(event);
    };
    const corners = [[100, 50], [180, 70], [100, 50], [180, 70], [100, 50], [180, 70], [100, 55]];
    send('pointerdown', 100, 50, 0);
    let elapsed = 0;
    for (let i = 1; i < corners.length; i++) for (let j = 1; j <= 6; j++) {
      const [ax, ay] = corners[i - 1]!; const [bx, by] = corners[i]!;
      send('pointermove', ax! + (bx! - ax!) * j / 6, ay! + (by! - ay!) * j / 6, elapsed += 10);
    }
    send('pointerup', 100, 55, elapsed);
  });
  await expect.poll(() => inkPixels(row)).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(row)).toBe(before);
});

test('main page zoom retains sharp ink and permits more writing', async ({ page }) => {
  const row = rows(page).first();
  await draw(page, row, [[[100, 60], [180, 60]]]);
  const canvas = row.locator('canvas');
  const before = await inkPixels(row);
  const width = await canvas.evaluate((c: HTMLCanvasElement) => c.width);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -90);
  await page.keyboard.up('Control');
  const reset = page.getByRole('button', { name: 'Reset zoom to 100%', exact: true });
  await expect(reset).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(width);
  await reset.click();
  await expect.poll(() => inkPixels(row)).toBe(before);
  await draw(page, row, [[[240, 40], [240, 110]]]);
  await expect.poll(() => inkPixels(row)).toBeGreaterThan(before);
});
