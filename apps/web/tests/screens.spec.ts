import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * The screens, in both themes, at both widths.
 *
 * The api is answered from a fixture so the counts, the address and the deck
 * names are the same on every run. A difference in one of these images is a
 * difference in the interface, not in the data.
 */
const THEMES = ['dark', 'light'] as const;

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Nothing is measured for layout, but the tab bar's pill and the segmented
  // thumb are placed from the first frame, so one frame is enough.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test('sign in', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page, { signedIn: false });
      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`sign-in-${theme}.png`, { fullPage: true });
    });

    test('sign up', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page, { signedIn: false });
      await page.goto('/sign-up');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`sign-up-${theme}.png`, { fullPage: true });
    });

    test('today', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`today-${theme}.png`, { fullPage: true });
    });

    test('library', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/library');
      await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`library-${theme}.png`, { fullPage: true });
    });

    test('settings', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`settings-${theme}.png`, { fullPage: true });
    });

    /*
     * A sheet on a phone and a centred panel on a desktop, from the same
     * component. This is the one that would catch a later change putting the
     * dialog back behind the on-screen keyboard.
     */
    test('a dialog', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Change your password' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`dialog-${theme}.png`);
    });
  });
}

test('the interface in Russian', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'ru' });
  await useFixtures(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await settle(page);

  await expect(page).toHaveScreenshot('settings-ru.png', { fullPage: true });
});

/**
 * One second factor control, never two.
 *
 * Both were drawn whatever the account said, so somebody who had never set one
 * up was offered a row for turning it off. Nothing the screen could read said
 * which state it was in, because the account did not report it.
 */
test.describe('the second factor', () => {
  for (const on of [false, true]) {
    test(`offers one control when it is ${on ? 'on' : 'off'}`, async ({ page }) => {
      await usePreferences(page, { theme: 'dark', locale: 'en' });
      await useFixtures(page, { twoFactor: on });
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      const setUp = page.getByRole('button', { name: /Set up two-factor/ });
      const turnOff = page.getByRole('button', { name: /Turn off 2FA/ });

      await expect(setUp).toHaveCount(on ? 0 : 1);
      await expect(turnOff).toHaveCount(on ? 1 : 0);
    });
  }
});

/**
 * The setting that says the effect reaches cards as well.
 *
 * Settings is the screen where the bug was visible: the two sections built from
 * row groups took the glass and the two built from cards did not, because a
 * card wrote its own surface in a utility and a utility beats the stylesheet.
 * Nothing photographed this scope, which is how a setting that moved a quarter
 * of the interface shipped looking like it worked.
 */
test('glass on the cards as well', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en', glassScope: 'all' });
  await useFixtures(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await settle(page);

  const blurred = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-g="card"]')].filter(
        (card) => getComputedStyle(card).backdropFilter !== 'none',
      ).length,
  );

  // Every card on the screen, not the row groups alone.
  expect(blurred).toBeGreaterThan(3);

  await expect(page).toHaveScreenshot('settings-glass-cards.png', { fullPage: true });
});

test('glass turned off', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
  await useFixtures(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await settle(page);

  await expect(page).toHaveScreenshot('today-glass-off.png', { fullPage: true });
});
