import { expect, test } from '@playwright/test';

import { usePreferences } from './fixtures';

/**
 * The gallery, photographed.
 *
 * It renders every component in every state, both themes and all three glass
 * levels on one page, so one screenshot per width is the whole system. A change
 * to a token, a radius, a weight or a state shows up here before it shows up on
 * a screen somebody uses.
 */
test.describe('component gallery', () => {
  test('every component, every state', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'full', motion: 'system' });
    await page.goto('/dev/components');

    // The reading face changes the width of every heading on the page, so the
    // shot has to wait for it rather than catch the stand-in.
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'Components and every state' })).toBeVisible();

    await expect(page).toHaveScreenshot('gallery.png', { fullPage: true });
  });
});
