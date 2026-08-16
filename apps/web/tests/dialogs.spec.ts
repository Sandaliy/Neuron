import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * Every dialog fits a phone, whole, in both languages.
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
 * Russian is measured as well as English. It is the longer language of the two
 * almost everywhere, so a layout that fits in English and not in Russian is the
 * ordinary failure, not the exotic one.
 */
const LOCALES = [
  {
    code: 'ru',
    settings: 'Настройки',
    changePassword: 'Сменить пароль',
    regenerate: 'Заменить коды восстановления',
    issue: 'Выпустить новые коды',
    password: 'Твой пароль',
    secondFactor: 'Двухфакторная аутентификация',
    deleteAccount: 'Удалить аккаунт',
  },
  {
    code: 'en',
    settings: 'Settings',
    changePassword: 'Change your password',
    regenerate: 'Replace your recovery codes',
    issue: 'Generate new codes',
    password: 'Your password',
    secondFactor: 'Two-factor authentication',
    deleteAccount: 'Delete account',
  },
] as const;

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
