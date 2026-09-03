import { expect, test } from '@playwright/test';

import { manyNotes, useFixtures, usePreferences } from './fixtures';

for (const theme of ['dark', 'light']) {
  test(`virtual notes keep selection and refresh content in ${theme}`, async ({ page }) => {
    const notes = manyNotes(5000);
    let changed = false;

    await usePreferences(page, { theme, locale: 'en', glassScope: 'floating' });
    await useFixtures(page, { notes });
    await page.route('**/api/notes/status', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ ids: ['note_0'], status: 'known' });
      changed = true;
      await route.fulfill({ json: { changed: 1 } });
    });
    await page.route('**/api/notes?*', async (route) => {
      await route.fulfill({
        json: {
          items: changed
            ? [
                {
                  ...notes[0],
                  fields: { term: 'Updated word', translation: 'Updated meaning' },
                  status: 'known',
                },
                ...notes.slice(1),
              ]
            : notes,
        },
      });
    });

    await page.goto('/notes?deckId=d1');
    const first = page.getByRole('button', { name: 'Wort 1 word 1', exact: true });
    await expect(first).toBeVisible();
    expect((await first.boundingBox())?.height).toBe(52);
    await page.getByRole('button', { name: 'Select several', exact: true }).click();
    await first.focus();
    await page.keyboard.press('Space');
    await expect(first.locator('[data-selected]')).toHaveCount(1);
    await expect(page.getByText('Selected: 1', { exact: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 6000));
    await expect(first).toHaveCount(0);
    await expect(page.locator('[data-rows] [data-row]')).not.toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(first.locator('[data-selected]')).toHaveCount(1);
    await first.focus();
    await page.keyboard.press('Space');
    await expect(first.locator('[data-selected]')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(first).toBeFocused();
    expect(await first.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');

    await page.getByRole('button', { name: 'Mark as known', exact: true }).click();
    const updated = page.getByRole('button', { name: 'Updated word Updated meaning Known' });
    await expect(updated).toBeVisible();
    await expect(first).toHaveCount(0);
    await updated.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notes\/note_0$/);
  });
}
