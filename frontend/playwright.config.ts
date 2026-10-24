import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 3100;
// keep artifacts out of the watched project tree so the dev server never reloads mid-test
export const ARTIFACTS = join(tmpdir(), 'math-notebook-e2e');

/** E2E against the real UI and real Pyodide CAS, with the scripted (mock) AI provider. */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: ARTIFACTS,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1180, height: 820 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm prepare-assets && pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { LLM_PROVIDER: 'mock', NEXT_PUBLIC_AUTH_DEV_BYPASS: 'true', APP_ENV: 'local' },
  },
});
