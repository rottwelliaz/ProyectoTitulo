import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4322', browserName: process.env.QUALITY_BROWSER || 'chromium', ...(process.env.QUALITY_BROWSER ? {} : { channel: 'chrome' }), headless: true },
  webServer: process.env.TEST_EXTERNAL_SERVER ? undefined : {
    command: `node node_modules/astro/astro.js ${process.env.TEST_PREVIEW ? 'preview' : 'dev'} --host 127.0.0.1 --port 4322`,
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: !process.env.CI,
  },
});
