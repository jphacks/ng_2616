import { chromium, type FullConfig } from '@playwright/test';

// every route the suite visits; a missing notebook id still compiles the notebook route
const ROUTES = ['/notebooks', '/notebooks/00000000-0000-4000-8000-000000000000', '/settings', '/login'];

/**
 * The dev server compiles a route the first time it is requested and pushes a reload to every
 * open page when it does. Compiling all routes once, before any test starts, keeps parallel
 * tests from reloading each other mid-step.
 */
export default async function warmUp(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const route of ROUTES) await page.goto(baseURL + route, { waitUntil: 'load', timeout: 240_000 });
  await browser.close();
}
