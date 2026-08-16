import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * What happens when the on-screen keyboard arrives.
 *
 * This is the part of a phone interface that cannot be checked by looking at a
 * screenshot, and it is where this app was worst: the action at the bottom of a
 * dialog ended up behind the keys, and the only way to press it was to dismiss
 * the keyboard first.
 *
 * A browser on a desktop has no keyboard to raise, so the keyboard is staged.
 * `src/lib/viewport.ts` publishes exactly three things when one opens, and
 * everything downstream is CSS reading those three, so setting them by hand
 * exercises the same paths a real keyboard does.
 */
const KEYBOARD_PX = 336;

/**
 * Waits for everything that is moving to finish moving.
 *
 * A frame first, then the animations. A transition started by the style change
 * on the line above does not exist yet when the browser is asked, so collecting
 * them straight away returns an empty list and proves nothing.
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));

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

async function lowerKeyboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.documentElement;

    root.style.setProperty('--keyboard-inset', '0px');
    root.style.setProperty('--visual-viewport-height', `${window.innerHeight}px`);
    root.dataset['keyboard'] = 'closed';
  });

  await settled(page);
}

test.describe('the keyboard', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('leaves the action in a dialog reachable', async ({ page }) => {
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

  test('leaves the action in the two-factor dialog reachable', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Two-factor authentication' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await raiseKeyboard(page);

    const box = await page.getByRole('button', { name: 'Continue' }).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812 - KEYBOARD_PX);
  });

  /**
   * A dialog is centred in what is left of the screen, not in the screen.
   *
   * `position: fixed` measures the layout viewport, and iOS does not shrink
   * that for a keyboard, so centring in it puts a dialog half behind the keys.
   * The band the dialog sits in is `--visual-viewport-height` tall, which is
   * the part a person can actually see.
   */
  test('centres a dialog in what the keyboard leaves', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Change your password' }).click();
    await raiseKeyboard(page);

    const dialog = await page.locator('[data-g="panel"]').boundingBox();
    const visible = 812 - KEYBOARD_PX;

    expect(dialog).not.toBeNull();
    // Whole, above the keys, and no taller than the room there is.
    expect(dialog!.y).toBeGreaterThan(0);
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(visible + 1);

    // And centred in it: the room above and the room below agree.
    const above = dialog!.y;
    const below = visible - (dialog!.y + dialog!.height);

    expect(Math.abs(above - below)).toBeLessThanOrEqual(32);
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

    await page.getByLabel('Email').click();
    await page.getByLabel('Email').fill('anna@fastmail.com');
    await raiseKeyboard(page);

    /*
     * Three fields, a strength meter and two hints do not fit in the 476 pixels
     * a keyboard leaves, so what this proves is that the room is reserved and
     * the foot of the form lands on top of the keys rather than under them.
     *
     * Getting there is not the person's job. A real keyboard opening scrolls
     * the form to its foot, which is where the fields and the button both are;
     * that is `revealFocused` in `src/lib/viewport.ts` and it is covered by
     * `viewport.test.ts`, because a staged keyboard sets the variables without
     * the visual viewport ever changing.
     */
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settled(page);

    const box = await page.getByRole('button', { name: 'Create account' }).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(812 - KEYBOARD_PX);
  });

  /**
   * The signed out screens are a card in the middle, and the room inside it
   * contracts for the keyboard the same way a dialog's does.
   */
  test('centres the sign in form, and tightens it for the keyboard', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page, { signedIn: false });
    await page.goto('/sign-in');

    const form = page.locator('[data-form]');
    const before = await form.boundingBox();

    expect(before).not.toBeNull();
    // Centred: the room above the card and the room below it agree.
    expect(Math.abs(before!.y - (812 - (before!.y + before!.height)))).toBeLessThanOrEqual(32);

    await expect(form).toHaveCSS('row-gap', '24px');

    await raiseKeyboard(page);

    await expect(form).toHaveCSS('row-gap', '16px');

    const box = await page.getByRole('button', { name: 'Sign in' }).boundingBox();

    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(812 - KEYBOARD_PX);
  });

  /**
   * Setting up the second factor, step by step.
   *
   * This is the screen the whole rework was for. It used to be one step holding
   * the QR code, the setup key, the field for the code and the button, in a
   * sheet against the bottom edge: at 375 by 812 with the keys out, more than
   * half of it was below the fold, and every tap that opened or closed the
   * keyboard resized the box it was scrolling in and threw the scroll back to
   * the top.
   *
   * Three steps now, and each one fits whole in the part of the screen a person
   * can see, with nothing scrolling inside it.
   */
  test('fits every step of setting up the second factor', async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Two-factor authentication' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const dialog = page.locator('[data-g="panel"]');

    /** The dialog is whole, on screen, and nothing inside it is scrolled away. */
    const fits = async (step: string, keyboard: boolean): Promise<void> => {
      await settled(page);

      const box = await dialog.boundingBox();
      const visible = keyboard ? 812 - KEYBOARD_PX : 812;

      expect(box, step).not.toBeNull();
      expect(box!.y, step).toBeGreaterThan(0);
      expect(box!.y + box!.height, step).toBeLessThanOrEqual(visible + 1);

      const hidden = await page
        .locator('[data-dialog-body]')
        .evaluate((body) => body.scrollHeight - body.clientHeight);

      expect(hidden, `${step}: nothing hidden below the fold`).toBeLessThanOrEqual(1);
    };

    // One: the password, with the keyboard up.
    await page.getByLabel('Your password').fill('correct horse battery staple');
    await raiseKeyboard(page);
    await fits('the password', true);

    // Two: the QR and the setup key. No field, so no keyboard.
    await page.getByRole('button', { name: 'Continue' }).click();
    await lowerKeyboard(page);
    await expect(page.getByRole('button', { name: 'I have added it' })).toBeVisible();
    await fits('the QR code', false);

    // Three: the code from the app, with the keyboard up again.
    await page.getByRole('button', { name: 'I have added it' }).click();
    await page.getByLabel('Six digit code').click();
    await raiseKeyboard(page);
    await expect(page.getByRole('button', { name: 'Turn on 2FA' })).toBeVisible();
    await fits('the code', true);
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
