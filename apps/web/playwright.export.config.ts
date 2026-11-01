import { defineConfig, devices } from '@playwright/test';

import base from './playwright.config';

/** Kept separate so export acceptance does not overlap integration's project selection. */
export default defineConfig({
  ...base,
  testMatch: /account-export\.spec\.ts/,
  workers: 1,
  projects: [
    {
      name: 'export-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'export-phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
    { name: 'export-webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
});
