import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

test('a dismissed toast does not leave a layer over the bottom navigation', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en' });
  await useFixtures(page);
  await page.goto('/library');

  const barBefore = await page.locator('[data-g="tabbar"]').boundingBox();
  await page.getByRole('button', { name: 'Actions for Deutsch', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await page.locator('[data-g="tabbar"]').boundingBox())!.y).toBe(barBefore!.y);
  await page.getByRole('button', { name: 'Delete the deck' }).click();
  await expect(page.getByText('Deck deleted: Deutsch', { exact: true })).toBeVisible();

  if (page.viewportSize()?.width === 375) {
    await page.locator('[data-g="toast"]').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const toast = await page.locator('[data-g="toast"]').boundingBox();
    const settledBar = await page.locator('[data-g="tabbar"]').boundingBox();
    expect(toast!.y + toast!.height).toBeLessThanOrEqual(settledBar!.y - 8);
  }
  await expect(page.locator('[data-g="toast"]')).toHaveCount(0, { timeout: 6_000 });
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
