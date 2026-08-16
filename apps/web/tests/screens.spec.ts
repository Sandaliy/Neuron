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
     * A centred panel, at both widths, from the same component. This is the one
     * that would catch a later change putting the dialog back behind the
     * on-screen keyboard.
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

    /*
     * The step that did not fit. A QR code, the setup key under it and two
     * actions, all of it in one centred panel with nothing scrolled away.
     */
    test('the second factor, at the QR', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Two-factor authentication' }).click();
      await page.getByLabel('Your password').fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('button', { name: 'I have added it' })).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`totp-scan-${theme}.png`);
    });

    /*
     * The ten codes: the tallest thing this app puts in a dialog, and the one
     * where the action used to sit on top of the field above it.
     */
    test('the ten codes', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Replace your recovery codes' }).click();
      await page.getByLabel('Your password').fill('correct horse battery staple');
      await page.getByRole('button', { name: 'Generate new codes' }).click();
      await expect(page.getByText('4KQPX-2M7JW-DRTKM')).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`recovery-codes-${theme}.png`);
    });

    /*
     * Leaving, which now costs the password rather than a phrase copied off the
     * screen above the box it goes in.
     */
    test('deleting the account', async ({ page }) => {
      await usePreferences(page, { theme, locale: 'en' });
      await useFixtures(page);
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Delete account' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await settle(page);

      await expect(page).toHaveScreenshot(`delete-account-${theme}.png`);
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
 * One second factor control, named for the thing and not for the verb.
 *
 * Two rows were drawn whatever the account said, so somebody who had never set
 * one up was offered a row for turning it off. Then it was one row wearing two
 * different labels, which made a setting read as an action. It is one row, with
 * the state underneath it, and the account is what says which state that is.
 */
test.describe('the second factor', () => {
  for (const on of [false, true]) {
    test(`says it is ${on ? 'on' : 'off'}, in one row`, async ({ page }) => {
      await usePreferences(page, { theme: 'dark', locale: 'en' });
      await useFixtures(page, { twoFactor: on });
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

      const control = page.getByRole('button', { name: /Two-factor authentication/ });

      await expect(control).toHaveCount(1);
      await expect(control).toContainText(on ? 'On' : 'Off');

      // The verb belongs inside, on the button that does it, not on the row.
      await expect(page.getByRole('button', { name: /Set up two-factor/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Turn off 2FA$/ })).toHaveCount(0);
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
