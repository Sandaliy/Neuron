import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/sync-chaos',
  testMatch: ['reauth.ts', 'scenarios.ts'],
  globalSetup: './tests/sync-chaos/setup.ts',
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: 'artifacts/sync-chaos/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/sync-chaos/playwright-report', open: 'never' }],
  ],
  use: { actionTimeout: 12_000, navigationTimeout: 12_000, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
});
