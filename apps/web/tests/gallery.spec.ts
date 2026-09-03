import { expect, test } from '@playwright/test';

import { hostedWindowsSnapshot, useFixtures, usePreferences } from './fixtures';

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
    await useFixtures(page);
    await page.goto('/dev/components');

    // The reading face changes the width of every heading on the page, so the
    // shot has to wait for it rather than catch the stand-in.
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'Components and every state' })).toBeVisible();

    // A full-page shot asks Chromium to lay out nearly seventeen thousand
    // pixels. Wait until that height has held across several frames, or a
    // retry can photograph a different layout from the first attempt.
    await page.evaluate(async () => {
      let previous = document.documentElement.scrollHeight;
      let stableFrames = 0;

      for (let frame = 0; frame < 120 && stableFrames < 10; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));

        const height = document.documentElement.scrollHeight;
        stableFrames = height === previous ? stableFrames + 1 : 0;
        previous = height;
      }

      if (stableFrames < 10) {
        throw new Error('The component gallery did not reach a stable height');
      }
    });

    await expect(page).toHaveScreenshot(hostedWindowsSnapshot('gallery.png'), { fullPage: true });
  });
});
