import { test as base } from '@playwright/test';

export * from '@playwright/test';

type Cached = { status: number; headers: Record<string, string>; body: Buffer };

/**
 * Every test opens a fresh browser context, whose HTTP cache starts empty, so each one would
 * download Pyodide and its packages (tens of MB) again. A worker keeps what it fetched and
 * serves it to its later tests; the app and the CDN are untouched.
 */
export const test = base.extend<{ pyodideCache: void }, { pyodideStore: Map<string, Cached> }>({
  pyodideStore: [
    async ({}, use) => {
      await use(new Map());
    },
    { scope: 'worker' },
  ],
  pyodideCache: [
    async ({ context, pyodideStore }, use) => {
      await context.route('**/pyodide/**', async (route) => {
        const url = route.request().url();
        let hit = pyodideStore.get(url);
        if (!hit) {
          const res = await route.fetch();
          hit = { status: res.status(), headers: res.headers(), body: await res.body() };
          if (res.ok()) pyodideStore.set(url, hit);
        }
        await route.fulfill(hit);
      });
      await use();
    },
    { auto: true },
  ],
});
