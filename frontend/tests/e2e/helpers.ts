import { expect, type Locator, type Page } from '@playwright/test';
import { segmentsFromSource, toInputSegments } from '@mn/contracts/segments';

export const rows = (page: Page) => page.locator('[data-line-id]');

/**
 * The home page, hydrated: the loading skeleton is server-rendered and only the client
 * replaces it, so its absence means buttons now respond. Routes are compiled up front
 * (global-setup.ts), so no reload arrives afterwards.
 */
export async function openHome(page: Page, query = '') {
  await page.goto(`/notebooks${query}`);
  await expect(page.getByRole('heading', { name: 'Start something new' })).toBeVisible();
  await expect(page.locator('ul[aria-busy="true"]')).toHaveCount(0);
}

export async function openPreset(page: Page, name: RegExp) {
  await openHome(page);
  await page.getByRole('button', { name }).first().click();
  await page.waitForURL(/\/notebooks\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText('Checker ready')).toBeVisible({ timeout: 120_000 });
}

/** The canvas position once smooth scrolling (e.g. after Revise or a new line) has settled. */
async function stableBox(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  let prev = await target.boundingBox();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const cur = await target.boundingBox();
    if (prev && cur && Math.abs(cur.y - prev.y) < 0.5 && Math.abs(cur.x - prev.x) < 0.5) return cur;
    prev = cur;
  }
  return prev!;
}

/** Draw polylines (canvas-relative CSS px) on a line's canvas with the mouse. */
export async function draw(page: Page, row: Locator, strokes: number[][][]) {
  const box = await stableBox(page, row.locator('canvas'));
  for (const pts of strokes) {
    await page.mouse.move(box.x + pts[0]![0]!, box.y + pts[0]![1]!);
    await page.mouse.down();
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1]!;
      const [bx, by] = pts[k]!;
      for (let j = 1; j <= 6; j++) await page.mouse.move(box.x + ax! + ((bx! - ax!) * j) / 6, box.y + ay! + ((by! - ay!) * j) / 6);
    }
    await page.mouse.up();
  }
}

export const scribble = (page: Page, row: Locator) =>
  draw(page, row, [
    [
      [40, 60],
      [90, 40],
      [140, 80],
      [190, 50],
    ],
  ]);

export async function writeAndConfirm(page: Page, row: Locator = rows(page).last()) {
  await scribble(page, row);
  await row.getByRole('button', { name: 'Confirm' }).click();
}

export const inkPixels = (row: Locator) =>
  row.locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });

export const statusOf = (page: Page, index: number) => rows(page).nth(index).locator('button[title]').last();

function job(meta: unknown, kind: string, extra: Record<string, unknown>) {
  const now = new Date().toISOString();
  return { ok: true, request_id: crypto.randomUUID(), data: { job: { id: crypto.randomUUID(), kind, phase: 'done', meta, created_at: now, expires_at: now, ...extra } } };
}

export type Recognition = string | { fail: string } | { unparsed: string };

/** Scripted transcriptions: "$...$" marks math (contracts' segmentsFromSource). */
export async function mockRecognition(page: Page, script: Recognition[]) {
  const queue = [...script];
  await page.route('**/api/v1/recognize', async (route) => {
    const { meta } = route.request().postDataJSON();
    const next = queue.shift() ?? { fail: 'RECOGNIZE_UNREADABLE' };
    if (typeof next === 'object' && 'unparsed' in next) {
      const segments = [{ type: 'math', expr: ['Unparsed', next.unparsed], notation: 'plain', latex: next.unparsed }];
      await route.fulfill({ status: 202, json: job(meta, 'recognize', { state: 'succeeded', result: { segments, unreadable: false, mock: true, transcription: next.unparsed } }) });
      return;
    }
    if (typeof next !== 'string') {
      await route.fulfill({ status: 202, json: job(meta, 'recognize', { state: 'failed', error: { code: next.fail, message: 'scripted failure', retryable: true } }) });
      return;
    }
    const segments = segmentsFromSource(next);
    await route.fulfill({ status: 202, json: job(meta, 'recognize', { state: 'succeeded', result: { segments, unreadable: false, mock: true, transcription: next } }) });
  });
}

/** Scripted AI proposals; returns the list of suggest inputs the client sent. */
export async function mockSuggestions(page: Page, script: string[]) {
  const queue = [...script];
  const calls: Record<string, unknown>[] = [];
  await page.route('**/api/v1/suggest', async (route) => {
    const { meta, input } = route.request().postDataJSON();
    calls.push(input);
    const next = queue.shift();
    if (!next) {
      await route.fulfill({ status: 202, json: job(meta, 'suggest', { state: 'succeeded', result: { state: 'NONE', reason: 'SCRIPT_EMPTY', mock: true } }) });
      return;
    }
    const segments = segmentsFromSource(next);
    const candidate = {
      id: crypto.randomUUID(),
      mode: input.mode,
      content_hash: `sha256:${crypto.randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
      lines: [{ target: { id: input.target_line_id, role: 'step', segments: toInputSegments(segments) }, segments }],
    };
    await route.fulfill({ status: 202, json: job(meta, 'suggest', { state: 'succeeded', result: { state: 'GENERATED', mock: true, candidate } }) });
  });
  return calls;
}
