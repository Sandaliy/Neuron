import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * Every dialog fits a phone, whole, with either stored locale.
 *
 * The rule this file exists for: nothing a dialog holds may be below the fold
 * when it opens. A dialog that has to be scrolled is a dialog whose action a
 * person cannot see, and on the screens that matter here, the ten recovery
 * codes and setting up the second factor, the thing below the fold was the
 * button that finishes.
 *
 * Measured rather than photographed, because a screenshot of a scrolled dialog
 * looks fine: it shows the top of it. What says the content did not fit is the
 * difference between what the scrolling part holds and how tall it is.
 *
 * Both stored locales render English during the Phase 7 presentation gate.
 */
const LOCALES = (['ru', 'en'] as const).map((code) => ({
  code,
  settings: 'Settings',
  changePassword: 'Change your password',
  regenerate: 'Replace your recovery codes',
  issue: 'Generate new codes',
  password: 'Your password',
  secondFactor: 'Two-factor authentication',
  deleteAccount: 'Delete account',
}));
/** Nothing in the dialog is below the fold, and the dialog is on the screen. */
async function fitsWhole(page: Page, what: string): Promise<void> {
  const box = await page.locator('[data-g="panel"]').boundingBox();

  expect(box, what).not.toBeNull();
  expect(box!.y, `${what}: the top is on screen`).toBeGreaterThan(0);
  expect(box!.y + box!.height, `${what}: the bottom is on screen`).toBeLessThanOrEqual(813);

  const hidden = await page
    .locator('[data-dialog-body]')
    .evaluate((body) => body.scrollHeight - body.clientHeight);

  expect(hidden, `${what}: nothing hidden below the fold`).toBeLessThanOrEqual(1);
}

test.describe('the dialogs, on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const locale of LOCALES) {
    test(`fit whole in ${locale.code}`, async ({ page }) => {
      await usePreferences(page, { theme: 'dark', locale: locale.code });
      await useFixtures(page);
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: locale.settings })).toBeVisible();

      await page.getByRole('button', { name: locale.changePassword }).click();
      await fitsWhole(page, 'change password');
      await page.keyboard.press('Escape');

      // The password, then the ten codes, which is the tallest of them all.
      await page.getByRole('button', { name: locale.regenerate }).click();
      await fitsWhole(page, 'before the codes');
      await page.getByLabel(locale.password).fill('correct horse battery staple');
      await page.getByRole('button', { name: locale.issue }).click();
      await expect(page.getByText('4KQPX-2M7JW-DRTKM')).toBeVisible();
      await fitsWhole(page, 'the ten codes');

      // Undismissable, so this one is left behind rather than closed.
      await page.reload();
      await expect(page.getByRole('heading', { name: locale.settings })).toBeVisible();

      await page.getByRole('button', { name: locale.deleteAccount }).first().click();
      await fitsWhole(page, 'delete account');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: locale.secondFactor }).click();
      await fitsWhole(page, 'the second factor, at the password');
      await page.getByLabel(locale.password).fill('correct horse battery staple');
      await page.getByRole('button', { name: /Продолжить|Continue/ }).click();
      await fitsWhole(page, 'the second factor, at the QR');
      await page.getByRole('button', { name: /Добавил|I have added it/ }).click();
      await fitsWhole(page, 'the second factor, at the code');
    });
  }
});

/**
 * A new deck asks for a name and its two languages, and the dialog that sets
 * an older deck's languages asks for those two. Both fit a phone whole, and
 * with the keyboard up for the name the field and Create are still on screen.
 */
test.describe('the deck language dialogs, on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const locale of LOCALES) {
    test(`fit whole in ${locale.code}`, async ({ page }) => {
      await usePreferences(page, { theme: 'dark', locale: locale.code });
      await useFixtures(page, { collectionDownload: false });
      await page.route('**/api/decks/d3/practice', (route) =>
        route.fulfill({ json: { run: null, version: 0 } }),
      );
      await page.goto('/library');
      await page.getByRole('button', { name: 'New deck', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New deck' });
      await expect(dialog.getByLabel('Translation language', { exact: true })).toBeVisible();
      await fitsWhole(page, 'new deck');

      const name = dialog.getByLabel('Name', { exact: true });
      await name.focus();
      await page.evaluate(() => {
        // About what an iPhone keyboard with its suggestion bar covers.
        Object.defineProperty(visualViewport, 'height', {
          configurable: true,
          value: innerHeight - 336,
        });
        visualViewport!.dispatchEvent(new Event('resize'));
      });
      const band = 812 - 336;
      for (const part of [name, dialog.getByRole('button', { name: 'Create', exact: true })]) {
        const box = await part.boundingBox();
        expect(box, 'with the keyboard up').not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height, 'above the keyboard').toBeLessThanOrEqual(band);
      }
      await page.reload();

      await page.goto('/notes?deckId=d3');
      await page.getByRole('button', { name: 'Set languages', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Deck languages' })).toBeVisible();
      await fitsWhole(page, 'deck languages');
    });
  }
});

/**
 * Setting up the second factor on one phone means leaving Neuron for the
 * authenticator app with the setup key, and coming back for the code. Leaving
 * used to close the dialog, so the key on screen was gone by the time the
 * person returned.
 */
test('two-factor setup survives leaving the app and coming back', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en' });
  await useFixtures(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Two-factor authentication' }).click();
  await page.getByLabel('Your password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Enter the key by hand instead' }).click();
  const key = page.getByRole('textbox', { name: 'Enter the key by hand instead' });
  await expect(key).toHaveValue('JBSWY3DPEHPK3PXPJBSWY3DP');

  await page.evaluate(() => {
    const visibility = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.dispatchEvent(new Event('blur'));
    visibility(true);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    visibility(false);
    window.dispatchEvent(new Event('focus'));
  });

  await expect(page.getByRole('dialog', { name: 'Two-factor authentication' })).toBeVisible();
  await expect(key).toHaveValue('JBSWY3DPEHPK3PXPJBSWY3DP');
  await page.getByRole('button', { name: 'I have added it' }).click();
  await page.getByLabel('Six digit code').fill('123456');
  await expect(page.getByText('4KQPX-2M7JW-DRTKM')).toBeVisible();
});
