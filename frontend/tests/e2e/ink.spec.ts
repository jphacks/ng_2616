import { expect, test } from '@playwright/test';
import { draw, inkPixels, openPreset, rows, scribble } from './helpers';

test.describe('ink', () => {
  test.beforeEach(async ({ page }) => openPreset(page, /Untitled notebook/));

  test('every finished stroke stays visible (no flicker or lost strokes)', async ({ page }) => {
    const row = rows(page).last();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      await draw(page, row, [[[40 + i * 45, 40], [70 + i * 45, 110]]]);
      await page.waitForTimeout(80);
      const n = await inkPixels(row);
      expect(n, `after stroke ${i + 1}`).toBeGreaterThan(last);
      last = n;
    }
    await page.waitForTimeout(800);
    expect(await inkPixels(row)).toBe(last);
  });

  test('fast consecutive strokes are not lost by React re-renders', async ({ page }) => {
    const row = rows(page).last();
    for (let i = 0; i < 8; i++) {
      await draw(page, row, [[[30 + i * 35, 40], [55 + i * 35, 110]]]);
    }
    await page.waitForTimeout(600);
    const n = await inkPixels(row);
    expect(n).toBeGreaterThan(1000);
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  test('the eraser removes a whole stroke and Undo brings it back', async ({ page }) => {
    const row = rows(page).last();
    await draw(page, row, [[[60, 40], [60, 110]], [[200, 40], [200, 110]]]);
    const both = await inkPixels(row);
    await page.getByRole('button', { name: 'Eraser' }).click();
    await draw(page, row, [[[40, 75], [80, 75]]]);
    const after = await inkPixels(row);
    expect(after).toBeLessThan(both);
    expect(after).toBeGreaterThan(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => inkPixels(row)).toBe(both);
  });

  test('Clear line empties the draft; New line keeps the previous draft', async ({ page }) => {
    await scribble(page, rows(page).last());
    await page.getByRole('button', { name: 'Clear line' }).click();
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await scribble(page, rows(page).last());
    await page.getByRole('button', { name: 'New line' }).click();
    await expect(rows(page)).toHaveCount(2);
    expect(await inkPixels(rows(page).first())).toBeGreaterThan(0);
    expect(await inkPixels(rows(page).last())).toBe(0);
  });

  test('the first stroke on a draft that is not active is kept', async ({ page }) => {
    await scribble(page, rows(page).first());
    await page.getByRole('button', { name: 'New line' }).click();
    const before = await inkPixels(rows(page).first());
    await draw(page, rows(page).first(), [[[300, 40], [300, 110]]]);
    await expect.poll(() => inkPixels(rows(page).first())).toBeGreaterThan(before);
  });
});

test('a two-finger tap undoes the last stroke and a three-finger tap redoes it', async ({ page }) => {
  await openPreset(page, /Untitled notebook/);
  const row = rows(page).first();
  await scribble(page, row);
  const drawn = await inkPixels(row);
  expect(drawn).toBeGreaterThan(0);
  const cdp = await page.context().newCDPSession(page);
  const box = (await row.boundingBox())!;
  const tap = async (fingers: number) => {
    const touchPoints = Array.from({ length: fingers }, (_, i) => ({ x: box.x + 300 + i * 60, y: box.y + 60, id: i }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap(2);
  await expect.poll(() => inkPixels(row)).toBe(0);
  await expect(page.getByRole('status').filter({ hasText: 'Undone' })).toBeVisible();
  await tap(3);
  await expect.poll(() => inkPixels(row)).toBe(drawn);
});
