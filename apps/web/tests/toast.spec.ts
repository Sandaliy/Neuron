import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

test('a dismissed toast does not leave a layer over the bottom navigation', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en' });
  await useFixtures(page);
  await page.goto('/library');

  await page.getByRole('button', { name: 'Actions for Deutsch', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete the deck' }).click();
  await expect(page.getByText('Deutsch deleted', { exact: true })).toBeVisible();

  await expect(page.locator('[data-g="toast"]')).toHaveCount(0, { timeout: 6_000 });
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
