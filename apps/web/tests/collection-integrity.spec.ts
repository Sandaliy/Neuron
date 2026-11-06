const locale = 'en';
import { expect, test } from '@playwright/test';

import { manyNotes, useFixtures as stubApi, usePreferences as setPreferences } from './fixtures';

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

test.describe('Deleted browsing', () => {
  const firstNote = {
    id: 'deleted-note',
    deckId: 'leaf',
    noteType: 'vocab',
    fields: { term: 'lernen', translation: 'learn', example: 'Jeden Tag lernen' },
    deckPath: ['German', 'B1'],
    deckLive: true,
  };
  const secondNote = {
    ...firstNote,
    id: 'other-note',
    fields: { term: 'читать', translation: 'read' },
    deckPath: ['Russian', 'A1'],
  };

  test.beforeEach(async ({ page }) => {
    await setPreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
    await stubApi(page);
    await page.route('**/api/decks/deleted', (route) => route.fulfill({ json: { decks: [] } }));
    await page.route('**/api/notes/deleted', (route) =>
      route.fulfill({ json: { notes: [firstNote, secondNote] } }),
    );
  });

  async function openNotes(page: Page) {
    await page.goto('/library/deleted');
    await page
      .getByRole('radiogroup', { name: 'Deleted content' })
      .getByText('Notes', { exact: true })
      .click();
    await expect(page.getByText('lernen', { exact: true })).toBeVisible();
  }

  test('searches content and location, inspects extra content, sorts and remembers each category', async ({
    page,
  }) => {
    await openNotes(page);
    const search = page.getByRole('searchbox');
    await search.pressSequentially('LEARN german');
    await expect(search).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: '1 of 2' })).toBeVisible();
    await expect(page.getByText('читать', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'View content' }).click();
    await expect(page.getByText('Jeden Tag lernen', { exact: true })).toBeVisible();
    await search.fill('russian');
    await expect(page.getByText('читать', { exact: true })).toBeVisible();
    await search.fill('unmatched');
    await expect(page.getByText('No matches', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '0 of 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete permanently', exact: true })).toHaveCount(
      0,
    );
    await search.fill('');
    await page.getByRole('combobox', { name: 'Order' }).selectOption('reverse');
    await expect(page.getByRole('listitem').first()).toContainText('читать');
    // Native radio arrows are the category navigation, with independent searches.
    await page.getByRole('radio', { name: 'Notes', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: 'Folders & decks' })).toBeChecked();
    await search.fill('folder query');
    await page.getByRole('radio', { name: 'Folders & decks' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(search).toHaveValue('');
    await expect(page.getByRole('combobox', { name: 'Order' })).toHaveValue('reverse');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath('deleted-notes.png'), fullPage: true });
  });

  test('keeps ancestors in search and rechecks a child after its deleted parent is restored', async ({
    page,
  }) => {
    let restored = false;
    const requested: string[] = [];
    await page.route('**/api/decks/deleted', (route) =>
      route.fulfill({
        json: {
          decks: [
            { ...folder, context: restored, parentDeleted: false, pathNames: [] },
            { ...leaf, context: false, parentDeleted: !restored, pathNames: ['German'] },
            { ...rootDeck, context: false, parentDeleted: false, pathNames: [] },
          ],
        },
      }),
    );
    await page.route('**/api/decks/*/restore', (route) => {
      requested.push(route.request().url());
      restored = true;
      return route.fulfill({ json: { restored: 1 } });
    });
    await page.goto('/library/deleted');
    await page.getByRole('button', { expanded: true }).click();
    await expect(page.getByText('B1', { exact: true })).toHaveCount(0);
    await page.getByRole('searchbox').fill('B1');
    const child = page.getByRole('listitem').filter({ has: page.getByText('B1', { exact: true }) });
    const parent = page
      .getByRole('listitem')
      .filter({ has: page.getByText('German', { exact: true }) })
      .first();
    await expect(child).toBeVisible();
    await expect(child.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    await expect(child.getByText('Restore the parent folder first.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '1 of 3' })).toBeVisible();
    await expect(
      parent.getByRole('button', { name: 'Delete permanently', exact: true }),
    ).toHaveCount(0);
    await parent.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(child.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatch(/\/decks\/folder\/restore$/);
    await expect(page.getByRole('searchbox')).toHaveValue('B1');
    await page.screenshot({
      path: test.info().outputPath('deleted-hierarchy.png'),
      fullPage: true,
    });
  });

  test('restores only a matching Note, retains the query and reports partial recovery', async ({
    page,
  }) => {
    let removed = false;
    let fail = true;
    const requested: string[] = [];
    await page.route('**/api/notes/deleted', (route) =>
      route.fulfill({ json: { notes: removed ? [secondNote] : [firstNote, secondNote] } }),
    );
    await page.route('**/api/notes/*/restore', (route) => {
      requested.push(route.request().url());
      if (fail) return route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
      removed = true;
      return route.fulfill({
        json: { restored: true, cardsRestored: 1, cardsRemainingDeleted: 2 },
      });
    });
    await openNotes(page);
    await page.getByRole('searchbox').fill('LEARN german');
    await expect(page.getByRole('status').filter({ hasText: '1 of 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('lernen', { exact: true })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(
      page.getByText('Note restored. 2 cards remain deleted.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No matches', { exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveValue('LEARN german');
    expect(requested).toHaveLength(2);
    expect(requested.every((url) => url.endsWith('/notes/deleted-note/restore'))).toBe(true);
  });

  test('updates a Note that becomes blocked after a refused restore', async ({ page }) => {
    let blocked = false;
    await page.route('**/api/notes/deleted', (route) =>
      route.fulfill({ json: { notes: [{ ...firstNote, deckLive: !blocked }] } }),
    );
    await page.route('**/api/notes/deleted-note/restore', (route) => {
      blocked = true;
      return route.fulfill({ status: 409, json: { error: { code: 'restore_dependency' } } });
    });
    await openNotes(page);
    await page.getByRole('searchbox').fill('learn');
    await expect(page.getByRole('searchbox')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    await expect(
      page.getByText('Restore the deck and its parent folders first.', { exact: true }),
    ).toBeVisible();
  });

  test('keeps permanent deletion scoped to the chosen match and requires impact plus confirmation', async ({
    page,
  }) => {
    const purged: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/notes/deleted-note/purge-impact', async (route) => {
      await held;
      await route.fulfill({ json: { name: 'lernen', folders: 0, decks: 0, notes: 1, cards: 3 } });
    });
    await page.route('**/api/notes/*/purge', (route) => {
      purged.push(route.request().url());
      expect(route.request().postDataJSON()).toEqual({ confirmed: true });
      return route.fulfill({ json: { name: 'lernen', folders: 0, decks: 0, notes: 1, cards: 3 } });
    });
    await openNotes(page);
    await page.getByRole('searchbox').fill('learn german');
    await expect(page.getByRole('status').filter({ hasText: '1 of 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete “lernen” permanently?' });
    await expect(
      dialog.getByRole('button', { name: 'Delete permanently', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(
      dialog.getByRole('button', { name: 'Delete permanently', exact: true }),
    ).toBeDisabled();
    release();
    await expect(dialog.getByText('Folders: 0. Decks: 0. Notes: 1. Cards: 3.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(purged).toHaveLength(1);
    expect(purged[0]).toMatch(/\/notes\/deleted-note\/purge$/);
  });

  for (const kind of ['decks', 'notes'] as const) {
    test(`${kind}: loading, read failure and retry stay accessible`, async ({ page }) => {
      let release!: () => void;
      let failed = true;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**/api/${kind}/deleted`, async (route) => {
        if (failed) {
          await held;
          return route.fulfill({ status: 403, json: { error: { code: 'forbidden' } } });
        }
        return route.fulfill({ json: kind === 'decks' ? { decks: [] } : { notes: [firstNote] } });
      });
      await page.goto('/library/deleted');
      if (kind === 'notes')
        await page.getByRole('radiogroup').getByText('Notes', { exact: true }).click();
      await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
      release();
      await expect(page.getByRole('alert')).toBeVisible();
      failed = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByRole('searchbox')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }

  test('5000 deleted Notes retain a bounded, keyboard-reachable window and responsive search', async ({
    page,
  }) => {
    const notes = manyNotes(5000).map((note) => ({
      ...note,
      deckPath: ['German', 'Lesson 3'],
      deckLive: true,
    }));
    await page.route('**/api/notes/deleted', (route) => route.fulfill({ json: { notes } }));
    await page.goto('/library/deleted');
    await page.getByRole('radiogroup').getByText('Notes', { exact: true }).click();
    await expect(page.getByText('Wort 1', { exact: true })).toBeVisible();
    expect(await page.getByRole('listitem').count()).toBeLessThan(40);
    await page.getByRole('button', { name: 'Restore', exact: true }).first().focus();
    for (let i = 0; i < 50; i++) await page.keyboard.press('Tab');
    const position = await page.evaluate(() =>
      Number(document.activeElement?.closest('[role="listitem"]')?.getAttribute('aria-posinset')),
    );
    expect(position).toBeGreaterThan(20);
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('[role="listitem"]') !== null),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByText('Wort 5000', { exact: true })).toBeVisible();
    expect(await page.getByRole('listitem').count()).toBeLessThan(40);
    const search = page.getByRole('searchbox');
    await search.focus();
    const started = Date.now();
    await search.pressSequentially('Wort 4999');
    await expect(page.getByRole('status').filter({ hasText: '1 of 5000' })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(1500);
    await expect(search).toBeFocused();
    await expect(page.getByText('Wort 4999', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await search.fill('');
    await expect(page.getByRole('status').filter({ hasText: '5000 of 5000' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1200));
    const before = await page.evaluate(() => window.scrollY);
    const visiblePosition = await page.getByRole('listitem').evaluateAll((rows) =>
      rows
        .find((row) => {
          const box = row.getBoundingClientRect();
          return box.top >= 0 && box.bottom < innerHeight;
        })
        ?.getAttribute('aria-posinset'),
    );
    const row = page.locator(`[role="listitem"][aria-posinset="${visiblePosition}"]`);
    await row.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(3);
  });
});

async function setup(page: Page, storedLocale: 'en' | 'ru', theme: 'light' | 'dark') {
  await setPreferences(page, { locale: storedLocale, theme, glass: 'off' });
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

for (const storedLocale of ['en', 'ru'] as const)
  for (const theme of ['light', 'dark'] as const) {
    test(`${storedLocale} ${theme}: collection navigation, clean picker paths and safe import examples`, async ({
      page,
    }) => {
      await setup(page, storedLocale, theme);
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
      await expect(page.getByRole('button', { name: /^B1/ }).first()).toBeVisible();
      await expect(page).toHaveURL(/\/library$/);
      await page.getByRole('button', { name: /^German(?:\s|$)/ }).click();
      await expect(page).toHaveURL(/folderId=folder/);
      await page.getByRole('button', { name: /^B1/ }).first().click();
      await expect(page).toHaveURL(/notes\?deckId=leaf/);
      await page.goto('/import?deckId=leaf');
      const list = page.getByRole('button', {
        name: locale === 'en' ? 'List' : 'Список',
        exact: true,
      });
      await expect(list).toHaveAttribute('aria-pressed', 'true');
      await expect(list).toHaveClass(/bg-selected/);
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
        .getByText(locale === 'en' ? 'Change destination' : 'Изменить место', { exact: true })
        .click();
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Import into' : 'Импортировать в',
          exact: true,
        })
        .click();
      const picker = page.getByRole('dialog');
      await expect(picker.getByRole('button', { name: 'German', exact: true })).toBeVisible();
      await expect(picker.getByRole('button', { name: /^B1/ })).not.toContainText('—');
      await picker.getByRole('button', { name: 'Oxford 5000', exact: true }).click();
      await page.screenshot({
        path: test.info().outputPath(`import-${storedLocale}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });

    test(`${storedLocale} ${theme}: Deleted hierarchy and irreversible confirmation`, async ({
      page,
    }) => {
      await setup(page, storedLocale, theme);
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
        path: test.info().outputPath(`purge-${storedLocale}-${theme}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await dialog.getByRole('checkbox').click();
      await dialog.getByRole('button', { name: permanent, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText('B1', { exact: true })).toHaveCount(0);
    });
  }

test('partial swipe reveals one action with an accessible button fallback', async ({ page }) => {
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
  await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(0);
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 150 });
  await first.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 150, clientY: 151 });
  await first.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 260, clientY: 151 });
  await first.dispatchEvent('pointerup', { pointerType: 'touch' });
  await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(0);
  expect(removed).toBe(0);
  await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 150 });
  await first.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 150, clientY: 151 });
  await first.dispatchEvent('pointerup', { pointerType: 'touch' });
  await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(1);
  expect(removed).toBe(0);
  const second = page.getByRole('button', { name: /lesen/ }).first();
  await second.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 200 });
  await second.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 150, clientY: 201 });
  await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select notes', exact: true }).click();
  await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit selection', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => removed).toBe(1);
});

test('creation sends the kind and moves offer only folders', async ({ page }) => {
  await setup(page, 'en', 'light');
  // This case covers the existing online path before a collection download.
  await page.route('**/api/sync?*', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } }),
  );
  const created: Record<string, unknown>[] = [];
  await page.route('**/api/decks', (route) => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON() as Record<string, unknown>;
      created.push(data);
      return route.fulfill({ json: { deck: { ...rootDeck, ...data, parentId: null } } });
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
  await expect(page.getByText('German / B1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
});

test('committed swipe removes immediately and failure restores the row', async ({ page }) => {
  await setup(page, 'en', 'dark');
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/notes/n1', async (route) => {
    requests++;
    await barrier;
    await route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
  });
  await page.goto('/notes?deckId=leaf');
  const row = page.getByRole('button', { name: /lernen/ }).first();
  try {
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 300, clientY: 150 });
    await row.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 100, clientY: 151 });
    await row.dispatchEvent('pointerup', { pointerType: 'touch' });
    await expect(row).toHaveCount(0);
  } finally {
    release();
  }
  await expect(row).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.locator('[data-toasts]')).toContainText(
    /Something went wrong|Try again|try again/,
  );
});

test('file chooser shows one filename and scoped breadcrumbs remain compact', async ({ page }) => {
  await setup(page, 'en', 'dark');
  await page.goto('/import?deckId=leaf');
  const path = page.getByRole('navigation', { name: 'Deck', exact: true });
  await expect(path.getByRole('button', { name: 'German', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import into', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByText('No file selected', { exact: true })).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file', exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'words.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('word — meaning'),
  });
  await expect(page.getByText('words.txt', { exact: true })).toHaveCount(1);
  await expect(page.getByText('No file selected', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await path.getByRole('button', { name: 'German', exact: true }).click();
  await expect(page).toHaveURL(/folderId=folder/);
});
