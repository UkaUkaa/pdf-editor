import { defineConfig } from '@playwright/test';

/** End-to-end tests drive the built Electron application (run `npm run build` first). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { actionTimeout: 8_000 },
  expect: { timeout: 8_000 },
});
