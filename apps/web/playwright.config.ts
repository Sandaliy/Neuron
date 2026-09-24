import { defineConfig, devices } from '@playwright/test';

/** Browser interactions and Windows-specific visual contracts have separate CI paths. */
export default defineConfig({
  testDir: './tests',

  /*
   * The hosted frame-rate benchmark and the visual snapshot suite are isolated
   * from concurrent work. Keep both on one worker so throttled measurements and
   * screenshots remain honest; the blocking interaction suite can use two.
   */
  fullyParallel: false,
  workers:
    process.env['PERFORMANCE_BENCHMARK'] === 'true' ||
    process.env['VISUAL_SNAPSHOT_SUITE'] === 'true'
      ? 1
      : 2,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? 'line' : [['list']],

  expect: {
    toHaveScreenshot: {
      // Enough for antialiasing to differ, far too little for a colour, a
      // space or a weight to change without the test saying so.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'webkit-phone-interaction',
      testMatch: /stabilization\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'phone',
      testMatch: /(?:gallery|screens)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'desktop',
      testMatch: /(?:gallery|screens)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'phone-interaction',
      testIgnore: /(?:gallery|screens|performance)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'desktop-interaction',
      // The frame rate budgets are phone measurements. Running them again at
      // 1440 measures a different thing and calls it the same name.
      testIgnore: /(?:gallery|screens|performance)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'phone-performance',
      testMatch: /(?:00-note-list-performance|performance)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
  ],

  webServer: {
    command:
      process.env['CI'] === 'true'
        ? 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173'
        : 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
