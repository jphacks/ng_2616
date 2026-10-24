import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';
import { ARTIFACTS } from '../../playwright.config';
import { openPreset } from './helpers';

/** Any ink works: the mock recognizer maps the n-th student line to the scripted line. */
async function scribble(page: Page, row: Locator) {
  const canvas = row.locator('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(box.x + 40 + i * 14, box.y + 60 + Math.sin(i) * 16, { steps: 2 });
  await page.mouse.up();
}

const rows = (page: Page) => page.locator('[data-line-id]');

/** The Schrödinger template's given lines: statement, TDSE, functions, conditions. */
const GIVEN = 4;

test('Schrödinger demo: student lines, CAS-gated AI steps, rejected wrong step, unverified steps', async ({ page }) => {
  await openPreset(page, /Schrödinger/);

  // the student writes lines 1–2
  for (const [i, status] of [[1, 'Definition'], [2, 'Verified']] as const) {
    await scribble(page, rows(page).last());
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(rows(page).nth(GIVEN + i - 1).getByRole('button', { name: status })).toBeVisible();
  }

  // the AI proposes the rest; each proposal is checked before it appears
  const statuses: string[] = [];
  let sawRejection = false;
  for (let i = 0; i < 14; i++) {
    const accept = page.getByRole('button', { name: /Accept/ }).first();
    await expect(accept).toBeVisible({ timeout: 45_000 });
    const chip = page.getByText('Checker rejected a suggestion');
    if (!sawRejection && (await chip.isVisible())) {
      // the deliberately wrong step (φ = e^{+iEt/ħ}) was rejected by the checker, never offered
      sawRejection = true;
      await chip.click();
      await expect(page.getByText('Sign error')).toBeVisible();
      await page.screenshot({ path: join(ARTIFACTS, 'demo-rejection.png') });
      await page.keyboard.press('Escape');
      await expect(page.getByText('Sign error')).toBeHidden();
    }
    const unverified = await page.getByText(/^Unverified ·/).isVisible();
    await page.keyboard.press('Tab');
    if (unverified) {
      await expect(page.getByText(/could not confirm this step/)).toBeVisible();
      await page.keyboard.press('Tab');
    }
    await expect(rows(page)).toHaveCount(GIVEN + 4 + i);
    const adopted = rows(page).nth(GIVEN + 2 + i);
    statuses.push((await adopted.locator('button[title]').last().getAttribute('title')) ?? '');
  }

  expect(sawRejection).toBe(true);
  expect(statuses.some((s) => s.startsWith('Starting line'))).toBe(false);
  expect(statuses.filter((s) => s.startsWith('Verified')).length).toBeGreaterThanOrEqual(8);
  expect(statuses.some((s) => s.startsWith('Not verified'))).toBe(true);
  expect(statuses.some((s) => s.startsWith('Local step'))).toBe(true);
  await page.screenshot({ path: join(ARTIFACTS, 'demo-final.png') });
  console.log(statuses.join('\n'));
});

test('undo and redo restore lines without re-checking', async ({ page }) => {
  await openPreset(page, /Expand a polynomial/);
  await scribble(page, rows(page).last());
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();
});
