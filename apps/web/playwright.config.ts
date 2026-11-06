import { defineConfig, devices } from '@playwright/test';

/** Browser interactions and Windows-specific visual contracts have separate CI paths. */
export default defineConfig({
  testDir: './tests',

  /*
   * Hosted interactions include frame measurements and clicks during animation.
   * Keep CI, frame-rate benchmarks and visual snapshots serial so concurrent
   * browsers do not compete for rendering time. Local interaction runs may use two workers.
   */
  fullyParallel: false,
  workers:
    Boolean(process.env['CI']) ||
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
    // Routed API fixtures must own their requests. Real PWA journeys explicitly
    // enable workers and use disposable HTTP origins instead of page routes.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'webkit-phone-interaction',
      testMatch:
        /(?:possible-duplicates|import|connectivity-live|offline(?:-live|-collections(?:-live)?|-renames|-notes|-note-creation(?:-live)?|-reviews|-practice)?|stabilization|rich-study|study|study-language|practice-setup|navigation|library-polish|note-list|learning-live|offline-review-live|offline-study(?:-live)?|phase84-latency|acceptance-motion|interaction-lifecycle|polish(?:-visual)?|triage|learning-waves)\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'phone',
      testMatch: /(?:gallery|screens)\.spec\.ts/,
      use: {
        // Visual baselines include real shell readiness, as before.
        serviceWorkers: 'allow',
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: 'desktop',
      testMatch: /(?:gallery|screens)\.spec\.ts/,
      use: {
        serviceWorkers: 'allow',
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
      // This benchmark explicitly fixes its viewport at 375px. Keep its three
      // glass modes in phone-interaction instead of repeating them under a
      // desktop label. Ordinary motion and interaction cases still run here.
      testIgnore: /(?:gallery|screens|performance|interaction-lifecycle)\.spec\.ts/,
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
    // CI builds the web package first and serves that artifact through Vite's
    // production-like preview server. Local iteration keeps the faster dev server.
    command: process.env['CI']
      ? 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --strictPort'
      : 'node ./node_modules/vite/bin/vite.js --host',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
