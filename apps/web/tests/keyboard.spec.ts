import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * What happens when the on-screen keyboard arrives.
 *
 * This is the part of a phone interface that cannot be checked by looking at a
 * screenshot, and it is where this app was worst: the action at the bottom of a
 * sheet ended up behind the keys, and the only way to press it was to dismiss
 * the keyboard first.
 *
 * A browser on a desktop has no keyboard to raise, so the keyboard is staged.
 * `src/lib/viewport.ts` publishes exactly three things when one opens, and
 * everything downstream is CSS reading those three, so setting them by hand
 * exercises the same paths a real keyboard does.
 */
const KEYBOARD_PX = 336;

/** Waits for everything that is moving to finish moving. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );

    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function raiseKeyboard(page: Page): Promise<void> {
  await settled(page);

  await page.evaluate((keyboard: number) => {
    const root = document.documentElement;

    // Exactly what `trackViewport` publishes for a keyboard: its height, no
    // browser furniture, and a visual viewport shortened by it.
    root.style.setProperty('--keyboard-inset', `${keyboard}px`);
    root.style.setProperty('--chrome-inset', '0px');
    root.style.setProperty('--visual-viewport-height', `${window.innerHeight - keyboard}px`);
    root.dataset['keyboard'] = 'open';
  }, KEYBOARD_PX);

  await settled(page);
}

test.describe('the keyboard', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('leaves the action in a sheet reachable', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Change your password' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await raiseKeyboard(page);

    const save = page.getByRole('button', { name: 'Save' });
    const box = await save.boundingBox();

    expect(box).not.toBeNull();

    // The keys start here. The button has to be above it, not merely present.
    const keyboardTop = 812 - KEYBOARD_PX;

    expect(box!.y + box!.height).toBeLessThanOrEqual(keyboardTop);
    expect(box!.y).toBeGreaterThan(0);
  });

  test('leaves the action in the two-factor sheet reachable', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await raiseKeyboard(page);

    const box = await page.getByRole('button', { name: 'Continue' }).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812 - KEYBOARD_PX);
  });

  test('lets the body of a sheet scroll instead of the sheet growing', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Change your password' }).click();
    await raiseKeyboard(page);

    const sheet = await page.locator('[data-g="sheet"]').boundingBox();

    expect(sheet).not.toBeNull();
    // The whole sheet fits above the keys. Anything taller scrolls inside.
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(812 - KEYBOARD_PX + 1);
  });

  test('takes the tab bar out of the way', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/');

    const bar = page.locator('[data-g="tabbar"]');

    await expect(bar).toBeVisible();

    const before = await bar.boundingBox();

    expect(before!.y).toBeLessThan(812);

    await raiseKeyboard(page);

    await expect(bar).toHaveCSS('opacity', '0');

    const after = await bar.boundingBox();

    // Gone downward, not merely faded: it comes back from where it went.
    expect(after!.y).toBeGreaterThan(before!.y);
  });

  test('keeps the button on the sign up form reachable', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page, { signedIn: false });
    await page.goto('/sign-up');

    await page.getByLabel('Email').fill('anna@fastmail.com');
    await raiseKeyboard(page);

    /*
     * A sign up form is taller than the space a keyboard leaves, so what has to
     * be true is that the button can be reached, not that it is already on
     * screen. Before this the page was exactly as tall as the screen and there
     * was nowhere to scroll to: the button sat behind the keys, and the only
     * way to press it was to dismiss the keyboard first.
     */
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settled(page);

    const box = await page.getByRole('button', { name: 'Create account' }).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812 - KEYBOARD_PX);
  });

  /**
   * Every field is sixteen pixels.
   *
   * Below that, iOS Safari zooms the page the moment a field is focused and
   * never zooms back out, which leaves the whole app at about 110% and scrolled
   * sideways. It is the one type size in the system that is a platform rule
   * rather than a step on the scale.
   */
  test('has no field small enough to make iOS zoom', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page, { signedIn: false });

    for (const path of ['/sign-in', '/sign-up', '/recovery']) {
      await page.goto(path);

      const sizes: number[] = await page.evaluate(() =>
        [...document.querySelectorAll('input, textarea, select')]
          .filter((field) => getComputedStyle(field).position !== 'absolute')
          .map((field) => Number.parseFloat(getComputedStyle(field).fontSize)),
      );

      expect(sizes.length, path).toBeGreaterThan(0);

      for (const size of sizes) {
        expect(size, path).toBeGreaterThanOrEqual(16);
      }
    }
  });
});
