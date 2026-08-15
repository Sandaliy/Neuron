import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

/**
 * Movement, and the promise that it stops.
 *
 * The stylesheet says every duration collapses to a millisecond when the system
 * asks for less movement, and the switch in Appearance does the same thing by
 * hand. A promise in a stylesheet is worth what it is tested at, so this reads
 * the computed value out of a real browser in both cases.
 */

/** Everything on screen that could be moving, in one query. */
const DURATIONS = `
  Array.from(document.querySelectorAll('*')).flatMap((element) => {
    const style = getComputedStyle(element);
    return [
      ...style.transitionDuration.split(',').map((value) => value.trim()),
      ...style.animationDuration.split(',').map((value) => value.trim()),
    ];
  }).filter((value) => value !== '0s')
`;

test.describe('reduced motion', () => {
  test('the system asking for less stops everything', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const durations: string[] = await page.evaluate(DURATIONS);

    expect(durations.length).toBeGreaterThan(0);

    for (const duration of durations) {
      expect.soft(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
    }
  });

  test('the switch in Appearance does the same by hand', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en', motion: 'reduce' });
    await useFixtures(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');

    const durations: string[] = await page.evaluate(DURATIONS);

    for (const duration of durations) {
      expect.soft(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
    }
  });

  test('without it, things do move', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const durations: string[] = await page.evaluate(DURATIONS);

    // Otherwise the two tests above would pass on a page with no motion in it
    // at all, which is not what they are meant to prove.
    expect(durations.some((duration) => Number.parseFloat(duration) > 0.001)).toBe(true);
  });

  /**
   * Nothing transitions a property that costs layout, and nothing transitions a
   * filter.
   *
   * Colour, shadow and outline are paint work the compositor already does; a
   * width or a top is a reflow on every frame, and a blur radius is the whole
   * layer rasterised again on every frame. The keyframes themselves are checked
   * against the stylesheet in `src/styles/motion.test.ts`, which runs in CI.
   */
  test('nothing transitions a property that costs layout or a filter', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const offenders: string[] = await page.evaluate(() => {
      const forbidden = [
        'width',
        'height',
        'top',
        'right',
        'bottom',
        'left',
        'inset',
        'margin',
        'padding',
        'font-size',
        'line-height',
        'filter',
        'backdrop-filter',
        'flex',
        'grid',
        'block-size',
        'inline-size',
      ];

      const found: string[] = [];

      for (const element of document.querySelectorAll('*')) {
        const property = getComputedStyle(element).transitionProperty;

        for (const name of property.split(',').map((value) => value.trim())) {
          if (forbidden.some((bad) => name === bad || name.startsWith(`${bad}-`))) {
            found.push(name);
          }
        }
      }

      return [...new Set(found)];
    });

    expect(offenders).toEqual([]);
  });

  test('the blur radius is never transitioned', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/');

    const animated: string[] = await page.evaluate(() => {
      const found: string[] = [];

      for (const element of document.querySelectorAll('[data-g]')) {
        const style = getComputedStyle(element);

        if (/filter/.test(style.transitionProperty) || /filter/.test(style.animationName)) {
          found.push(element.tagName);
        }
      }

      return found;
    });

    expect(animated).toEqual([]);
  });
});
