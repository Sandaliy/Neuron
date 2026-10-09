import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

test('matched interaction probe separates transport and repeated readiness', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
  await useFixtures(page);
  const reads: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/study/session') || path.endsWith('/practice') || path.endsWith('/notes')) {
      reads.push(path);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (path.endsWith('/practice')) return route.fulfill({ json: { run: null, version: 0 } });
    return route.fallback();
  });
  const started = performance.now();
  await page.goto('/');
  const study = page.getByRole('button', { name: 'Study', exact: true });
  await expect(study).toBeEnabled();
  const firstReadyMs = performance.now() - started;
  const returns: number[] = [];
  for (let n = 0; n < 3; n++) {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const at = performance.now();
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(study).toBeEnabled();
    returns.push(performance.now() - at);
  }
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('recognition');
  await expect(study).toBeEnabled();
  const modeAt = performance.now();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('');
  await expect(study).toBeEnabled();
  const modeReturnMs = performance.now() - modeAt;
  await page.goto('/notes?deckId=d3');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeVisible();
  await expect(page.locator('[data-row]').first()).toBeVisible();
  const practiceAt = performance.now();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Practice', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeVisible();
  const result = {
    transportMs: 250,
    firstReadyMs,
    returns,
    modeReturnMs,
    practiceSetupMs: performance.now() - practiceAt,
    reads,
  };
  console.info('acceptance-latency', JSON.stringify(result));
  await info.attach('interaction-latency', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
