import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

test.describe('phone deck menu isolation', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  async function openMenu(page: Parameters<typeof useFixtures>[0], name = 'Deutsch') {
    await page.locator(`button[aria-label="Actions for ${name}"]`).click();
    await expect(page.getByRole('menu')).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page);
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  });

  test('opens without navigating, and each action stays isolated', async ({ page }) => {
    await openMenu(page);
    await expect(page).toHaveURL(/\/library$/);

    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Deck settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
  });

  test('disabled reorder actions are inert', async ({ page }) => {
    await page.route('/api/decks', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { decks: [{ ...singleDeck('only'), children: [] }] } });
      } else {
        await route.fallback();
      }
    });
    await page.reload();
    await openMenu(page, 'Only');

    await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Move up' }).click({ force: true });
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Open navigates and the old menu does not reappear on back', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/notes\?deckId=d1/);
    await page.goBack();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});

test('deck create stays successful when the refresh fails', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en' });
  await useFixtures(page);
  let failRefresh = false;
  await page.route('/api/decks', async (route) => {
    if (route.request().method() === 'POST') {
      failRefresh = true;
      await route.fulfill({ status: 201, json: { deck: { id: 'created', name: 'Fresh' } } });
      return;
    }
    if (failRefresh) {
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  await page.goto('/library');
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByLabel('Name').fill('Fresh');
  await page.getByRole('button', { name: 'Create the deck' }).click();
  await expect(page.getByText('Fresh created', { exact: true })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('note create stays successful when the refresh fails', async ({ page }) => {
  await usePreferences(page, { theme: 'dark', locale: 'en' });
  await useFixtures(page);
  let failRefresh = false;
  await page.route('/api/notes', async (route) => {
    if (route.request().method() === 'POST') {
      failRefresh = true;
      await route.fulfill({
        status: 201,
        json: {
          note: {
            id: 'created-note',
            deckId: 'd1',
            noteType: 'vocab',
            fields: { term: 'neu', translation: 'new' },
            tags: [],
            status: 'active',
          },
          cards: [],
        },
      });
      return;
    }
    if (failRefresh) {
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  await page.goto('/notes/new?deckId=d1');
  await page.getByRole('textbox', { name: 'Word' }).fill('neu');
  await page.getByRole('textbox', { name: 'Translation' }).fill('new');
  await page.getByRole('button', { name: 'Save the note' }).click();
  await expect(page).toHaveURL(/\/notes\/created-note$/);
  await expect(page.getByText('Not saved')).toHaveCount(0);
});

function singleDeck(id: string) {
  return {
    id,
    name: 'Only',
    parentId: null,
    position: 0,
    path: [],
    settings: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
    due: 0,
    fresh: 0,
  };
}
