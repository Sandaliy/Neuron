import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

/** Kept separate so export acceptance does not overlap integration's project selection. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5197' },
  webServer: {
    command: process.env['CI']
      ? 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5197 --strictPort'
      : 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  testMatch: /account-export\.spec\.ts/,
  workers: 1,
  projects: [
    {
      name: 'desktop-interaction',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone-interaction',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    { name: 'webkit-phone-interaction', use: { ...devices['iPhone 13'] } },
  ],
});
