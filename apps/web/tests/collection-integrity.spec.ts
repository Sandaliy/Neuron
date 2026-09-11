import { expect, test } from '@playwright/test';

import { useFixtures as stubApi, usePreferences as setPreferences } from './fixtures';

import type { Page } from '@playwright/test';

const leaf = {
  id: 'leaf',
  name: 'B1',
  kind: 'deck',
  parentId: 'folder',
  path: ['folder'],
  children: [],
  due: 0,
  fresh: 1,
  settings: null,
};
const folder = {
  id: 'folder',
  name: 'German',
  kind: 'folder',
  parentId: null,
  path: [],
  children: [leaf],
  due: 0,
  fresh: 1,
  settings: null,
};
const rootDeck = { ...leaf, id: 'root-deck', name: 'Oxford 5000', parentId: null, path: [] };

async function setup(page: Page, locale: 'en' | 'ru', theme: 'light' | 'dark') {
  await setPreferences(page, { locale, theme, glass: 'off' });
  await stubApi(page);
  await page.route('**/api/decks', (route) =>
    route.fulfill({ json: { decks: [folder, rootDeck] } }),
  );
  await page.route('**/api/notes?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'n1',
            deckId: 'leaf',
            fields: { term: 'lernen', translation: 'learn' },
            noteType: 'vocab',
            status: 'active',
            tags: [],
          },
          {
            id: 'n2',
            deckId: 'leaf',
            fields: { term: 'lesen', translation: 'read' },
            noteType: 'vocab',
            status: 'active',
            tags: [],
          },
        ],
      },
    }),
  );
}

for (const locale of ['en', 'ru'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`${locale} ${theme}: collection navigation, clean picker paths and safe import examples`, async ({
      page,
    }) => {
      await setup(page, locale, theme);
      await page.goto('/library');
      await expect(
        page.getByRole('button', {
          name: locale === 'en' ? 'New folder' : 'Новая папка',
          exact: true,
        }),
      ).toBeVisible();
      const expand = page.getByRole('button', {
        name: locale === 'en' ? 'Show what is inside' : 'Показать, что внутри',
        exact: true,
      });
      await expand.click();
      await expect(page.getByRole('button', { name: /B1/ }).first()).toBeVisible();
      await expect(page).toHaveURL(/\/library$/);
      await page.getByRole('button', { name: 'German', exact: true }).click();
      await expect(page).toHaveURL(/folderId=folder/);
      await page.getByRole('button', { name: /B1/ }).first().click();
      await expect(page).toHaveURL(/notes\?deckId=leaf/);
      await page.goto('/import?deckId=leaf');
      const list = page.getByRole('button', {
        name: locale === 'en' ? 'List' : 'Список',
        exact: true,
      });
      await expect(list).toHaveAttribute('aria-pressed', 'true');
      await expect(list.locator('svg')).toBeVisible();
      await page.getByRole('button', { name: 'JSON', exact: true }).click();
      await expect(page.getByRole('button', { name: 'JSON', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const input = page.locator('textarea').first();
      await input.fill('Keep my pasted material');
      await page
        .getByText(locale === 'en' ? 'Example and its cards' : 'Пример и его карточки', {
          exact: true,
        })
        .click();
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Insert example' : 'Вставить пример',
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page
        .getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Отмена', exact: true })
        .click();
      await expect(input).toHaveValue('Keep my pasted material');
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Import into' : 'Импортировать в',
          exact: true,
        })
        .click();
      const picker = page.getByRole('dialog');
      await expect(picker.getByRole('button', { name: /B1/ })).toContainText('German');
      await expect(picker.getByRole('button', { name: /B1/ })).not.toContainText('—');
      await picker.getByRole('button', { name: 'Oxford 5000', exact: true }).click();
      await page.screenshot({
        path: test.info().outputPath(`import-${locale}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });

    test(`${locale} ${theme}: Deleted hierarchy and irreversible confirmation`, async ({
      page,
    }) => {
      await setup(page, locale, theme);
      let purged = false;
      await page.route('**/api/decks/deleted', (route) =>
        route.fulfill({
          json: {
            decks: purged
              ? []
              : [
                  { ...folder, context: true, pathNames: [], parentDeleted: false },
                  { ...leaf, context: false, pathNames: ['German'], parentDeleted: false },
                ],
          },
        }),
      );
      await page.route('**/api/decks/leaf/purge-impact', (route) =>
        route.fulfill({ json: { name: 'B1', folders: 0, decks: 1, notes: 2, cards: 2 } }),
      );
      await page.route('**/api/decks/leaf/purge', (route) => {
        purged = true;
        return route.fulfill({ json: {} });
      });
      await page.goto('/library/deleted');
      await expect(page.getByText('German', { exact: true })).toBeVisible();
      await expect(page.getByText('B1', { exact: true })).toBeVisible();
      const permanent = locale === 'en' ? 'Delete permanently' : 'Удалить навсегда';
      await expect(page.getByRole('button', { name: permanent, exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: permanent, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('B1');
      await expect(dialog.getByRole('button', { name: permanent, exact: true })).toBeDisabled();
      await page.screenshot({
        path: test.info().outputPath(`purge-${locale}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await dialog.getByRole('checkbox').click();
      await dialog.getByRole('button', { name: permanent, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('B1', { exact: true })).toHaveCount(0);
    });
  }

test('swipe only reveals deletion, one row at a time, with an accessible button fallback', async ({
  page,
}) => {
  await setup(page, 'en', 'dark');
  let removed = 0;
  await page.route('**/api/notes/n1', (route) => {
    removed++;
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto('/notes?deckId=leaf');
  const first = page.getByRole('button', { name: /lernen/ }).first();
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 150 });
  await first.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 245, clientY: 195 });
  await expect(page.locator('[data-swipe-action]')).toHaveCount(0);
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 150 });
  await first.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 150, clientY: 151 });
  await first.dispatchEvent('pointerup', { pointerType: 'touch' });
  await expect(page.locator('[data-swipe-action]')).toHaveCount(1);
  expect(removed).toBe(0);
  const second = page.getByRole('button', { name: /lesen/ }).first();
  await second.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 200 });
  await second.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 150, clientY: 201 });
  await expect(page.locator('[data-swipe-action]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select notes', exact: true }).click();
  await expect(page.locator('[data-swipe-action]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit selection', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => removed).toBe(1);
});

test('creation sends the kind and moves offer only folders', async ({ page }) => {
  await setup(page, 'en', 'light');
  const created: Record<string, unknown>[] = [];
  await page.route('**/api/decks', (route) => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON() as Record<string, unknown>;
      created.push(data);
      return route.fulfill({ json: { ...rootDeck, ...data, parentId: null } });
    }
    return route.fulfill({ json: { decks: [folder, rootDeck] } });
  });
  await page.goto('/library');
  for (const kind of ['folder', 'deck']) {
    await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(`New ${kind}`);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(created.at(-1)).toMatchObject({ kind, parentId: null });
  }
  await page.getByRole('button', { name: 'Actions for Oxford 5000' }).click();
  await expect(page.getByRole('menuitem', { name: 'New deck', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /German/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /B1|Oxford 5000/ })).toHaveCount(0);
});

test('restore returns a nested deck and notes disclose a blocked dependency', async ({ page }) => {
  await setup(page, 'en', 'dark');
  let restored = false;
  await page.route('**/api/decks/deleted', (route) =>
    route.fulfill({
      json: {
        decks: restored
          ? []
          : [
              { ...folder, context: true, pathNames: [], parentDeleted: false },
              { ...leaf, context: false, pathNames: ['German'], parentDeleted: false },
            ],
      },
    }),
  );
  await page.route('**/api/decks/leaf/restore', (route) => {
    restored = true;
    return route.fulfill({ json: { restored: 1 } });
  });
  await page.route('**/api/notes/deleted', (route) =>
    route.fulfill({
      json: {
        notes: [
          {
            id: 'n1',
            deckId: 'leaf',
            noteType: 'vocab',
            fields: { term: 'lernen', translation: 'learn' },
            tags: [],
            status: 'active',
            deckPath: ['German', 'B1'],
            deckLive: false,
          },
        ],
      },
    }),
  );
  await page.goto('/library/deleted');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('B1', { exact: true })).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Deleted content' })
    .getByText('Notes', { exact: true })
    .click();
  await expect(page.getByText('lernen', { exact: true })).toBeVisible();
  await expect(page.getByText('B1', { exact: true })).toBeVisible();
  await expect(page.getByText('German', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
});
