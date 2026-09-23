import { defineConfig, devices } from '@playwright/test';

/**
 * The tests that need a real browser.
 *
 * Everything in `src/**` is jsdom under vitest, which is the right tool for
 * wiring. These are the three questions jsdom cannot answer: what the interface
 * looks like, whether it still moves when the system asks it not to, and
 * whether it holds its frame rate on a phone.
 *
 * The screenshots are the point. Nobody can quietly degrade the interface in a
 * later phase without one of these failing.
 *
 * Baselines carry the platform in their name, which is Playwright's own
 * default, because the interface face is the platform's: the same page is set
 * in SF Pro on a Mac and Segoe UI on Windows and neither is wrong. CI runs this
 * suite on Windows so it compares against the committed win32 baselines.
 */
export default defineConfig({
  testDir: './tests',

  /*
   * The hosted frame-rate benchmark and the visual snapshot suite are isolated
   * from concurrent work. Keep both on one worker so throttled measurements and
   * screenshots remain honest. The hosted interaction gate also sets one worker
   * explicitly; ordinary local runs keep the faster two-worker default.
   */
  fullyParallel: false,
  workers:
    process.env['PERFORMANCE_BENCHMARK'] === 'true' ||
    process.env['VISUAL_SNAPSHOT_SUITE'] === 'true'
      ? 1
      : 2,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI']
    ? [
        ['line'],
        [
          'html',
          {
            outputFolder: process.env['PLAYWRIGHT_HTML_OUTPUT_DIR'] ?? 'playwright-report',
            open: 'never',
          },
        ],
      ]
    : [['list']],

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
      testMatch: /(?:stabilization|rich-study)\.spec\.ts/,
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
      testIgnore: /(?:gallery|screens)\.spec\.ts/,
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
  ],

  webServer: {
    // CI builds the web package first and serves that artifact through Vite's
    // production-like preview server. Local iteration keeps the faster dev server.
    command: process.env['CI']
      ? 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort'
      : 'node ./node_modules/vite/bin/vite.js --host',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
