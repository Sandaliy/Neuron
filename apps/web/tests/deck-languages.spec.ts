import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures, usePreferences as installPreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * A new deck is made with both of its languages, and a deck made before that
 * rule says what it lacks without stopping anything else.
 *
 * These run without a downloaded collection, so creation and settings go
 * straight to the api; the device-saved path is in `offline-collections.spec.ts`.
 */

const at = '2026-01-01T00:00:00.000Z';

function row(
  id: string,
  name: string,
  settings: Record<string, unknown> | null,
  children: Record<string, unknown>[] = [],
  parentId: string | null = null,
): Record<string, unknown> {
  return {
    id,
    kind: children.length ? 'folder' : 'deck',
    name,
    parentId,
    position: 0,
    path: parentId ? [parentId] : [],
    settings,
    createdAt: at,
    updatedAt: at,
    rev: 1,
    due: 0,
    fresh: 0,
    noteCount: 0,
    children,
  };
}

/** A German folder, a folder that only knows its target language, and an old deck with none. */
function collection() {
  return [
    row('f-de', 'German', { targetLanguage: 'de', nativeLanguage: 'ru' }, [
      row('d-inherits', 'Inherits both', null, [], 'f-de'),
    ]),
    row('f-half', 'Half known', { targetLanguage: 'fr' }, [
      row('d-half', 'Missing translation', null, [], 'f-half'),
    ]),
    row('d-old', 'Old deck', { dailyStudyIncluded: true }),
  ];
}

/** Answers creation and settings like the api does, and remembers what was sent. */
async function api(page: Page) {
  const decks = collection();
  const sent: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const all = () => {
    const flat: Record<string, unknown>[] = [];
    const walk = (rows: Record<string, unknown>[]) =>
      rows.forEach((entry) => {
        flat.push(entry);
        walk(entry['children'] as Record<string, unknown>[]);
      });
    walk(decks);
    return flat;
  };
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page, { decks, collectionDownload: false });
  await page.route(
    (url) => url.pathname.startsWith('/api/decks'),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/decks')
        return route.fulfill({ json: { decks } });
      if (request.method() === 'POST' && path === '/api/decks') {
        const body = request.postDataJSON() as Record<string, unknown>;
        sent.push({ method: 'POST', path, body });
        const parentId = (body['parentId'] as string | null | undefined) ?? null;
        const created = {
          ...row(String(body['id']), String(body['name']), null, [], parentId),
          ...body,
          parentId,
          settings: body['settings'] ?? null,
        };
        const parent = all().find((entry) => entry['id'] === parentId);
        (parent ? (parent['children'] as Record<string, unknown>[]) : decks).push(created);
        const {
          children: _children,
          due: _due,
          fresh: _fresh,
          noteCount: _count,
          ...deck
        } = created;
        return route.fulfill({ status: 201, json: { deck } });
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as Record<string, unknown>;
        sent.push({ method: 'PATCH', path, body });
        const target = all().find((entry) => path.endsWith(`/${String(entry['id'])}`));
        if (!target) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
        target['settings'] = body['settings'];
        target['rev'] = Number(target['rev']) + 1;
        const {
          children: _children,
          due: _due,
          fresh: _fresh,
          noteCount: _count,
          ...deck
        } = target;
        return route.fulfill({ json: { deck } });
      }
      return route.fallback();
    },
  );
  return sent;
}

test('a new deck waits for both languages and sends them with the deck', async ({ page }) => {
  const sent = await api(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New deck' });
  const target = dialog.getByLabel('Language being learned', { exact: true });
  const translation = dialog.getByLabel('Translation language', { exact: true });
  const create = dialog.getByRole('button', { name: 'Create', exact: true });

  // At the top level nothing is guessed.
  await expect(target).toHaveValue('');
  await expect(translation).toHaveValue('');
  await dialog.getByLabel('Name', { exact: true }).fill('Lesson 1');
  await expect(create).toBeDisabled();
  await target.selectOption('de');
  await expect(create).toBeDisabled();
  await translation.selectOption('ru');
  await expect(create).toBeEnabled();
  // The empty choice cannot be picked back.
  await expect(target.locator('option[value=""]')).toBeDisabled();

  await create.click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual([
    {
      method: 'POST',
      path: '/api/decks',
      body: expect.objectContaining({
        kind: 'deck',
        name: 'Lesson 1',
        parentId: null,
        settings: { targetLanguage: 'de', nativeLanguage: 'ru' },
      }),
    },
  ]);
});

test('a folder fills in what it knows, and the deck keeps the languages as its own', async ({
  page,
}) => {
  const sent = await api(page);
  await page.goto('/library?folderId=f-de');
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New deck' });
  await expect(dialog.getByLabel('Language being learned', { exact: true })).toHaveValue('de');
  await expect(dialog.getByLabel('Translation language', { exact: true })).toHaveValue('ru');
  await dialog.getByLabel('Name', { exact: true }).fill('Lesson 2');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent.at(-1)?.body).toMatchObject({
    parentId: 'f-de',
    settings: { targetLanguage: 'de', nativeLanguage: 'ru' },
  });

  // A folder with only one language fills in only that one.
  await page.goto('/library?folderId=f-half');
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New deck' });
  await expect(dialog.getByLabel('Language being learned', { exact: true })).toHaveValue('fr');
  await expect(dialog.getByLabel('Translation language', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Name', { exact: true }).fill('Lesson 3');
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  await dialog.getByLabel('Translation language', { exact: true }).selectOption('en');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent.at(-1)?.body['settings']).toEqual({ targetLanguage: 'fr', nativeLanguage: 'en' });
});

test('a new folder is still only a name', async ({ page }) => {
  const sent = await api(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByLabel('Name', { exact: true }).fill('Spanish');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent.at(-1)?.body).not.toHaveProperty('settings');
});

test('an old deck without languages says so, keeps working, and sets them in one step', async ({
  page,
}) => {
  const sent = await api(page);
  await page.route('**/api/decks/d-old/practice', (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  await page.goto('/notes?deckId=d-old');
  await expect(page.getByRole('heading', { name: 'Old deck', exact: true })).toBeVisible();
  const notice = page.getByText('This deck’s languages are not set.', { exact: false });
  await expect(notice).toBeVisible();
  // Nothing waits on it.
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Set languages', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Deck languages' });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Language being learned', { exact: true }).selectOption('es');
  await dialog.getByLabel('Translation language', { exact: true }).selectOption('ru');
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  // Both are stored on the deck itself, and its other settings stay.
  expect(sent).toEqual([
    {
      method: 'PATCH',
      path: '/api/decks/d-old',
      body: {
        settings: { dailyStudyIncluded: true, targetLanguage: 'es', nativeLanguage: 'ru' },
      },
    },
  ]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Old deck', exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test('a deck that inherits both languages says nothing; one inherited is kept as a start', async ({
  page,
}) => {
  await api(page);
  for (const id of ['d-inherits', 'd-half'])
    await page.route(`**/api/decks/${id}/practice`, (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
  await page.goto('/notes?deckId=d-inherits');
  await expect(page.getByRole('heading', { name: 'Inherits both', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set languages', exact: true })).toHaveCount(0);

  await page.goto('/notes?deckId=d-half');
  await expect(page.getByRole('heading', { name: 'Missing translation' })).toBeVisible();
  await page.getByRole('button', { name: 'Set languages', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Deck languages' });
  await expect(dialog.getByLabel('Language being learned', { exact: true })).toHaveValue('fr');
  await expect(dialog.getByLabel('Translation language', { exact: true })).toHaveValue('');
});

test('deck settings never take a language away from a deck that has one', async ({ page }) => {
  await api(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New deck' });
  await dialog.getByLabel('Name', { exact: true }).fill('Own languages');
  await dialog.getByLabel('Language being learned', { exact: true }).selectOption('it');
  await dialog.getByLabel('Translation language', { exact: true }).selectOption('en');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // With nothing to inherit, "Not set" would take its languages away.
  await page.getByRole('button', { name: 'Actions for Own languages', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  for (const label of ['Language being learned', 'Translation language']) {
    const select = dialog.getByLabel(label, { exact: true });
    await expect(select).toHaveValue(label === 'Translation language' ? 'en' : 'it');
    await expect(select.locator('option[value=""]')).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The old deck has no language: "Not set" stays available so that its other
  // settings can be saved without choosing one.
  await page.getByRole('button', { name: 'Actions for Old deck', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(
    dialog.getByLabel('Language being learned', { exact: true }).locator('option[value=""]'),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // A deck that inherits from its folder can go back to inheriting.
  await page.goto('/library?folderId=f-de');
  await page.getByRole('button', { name: 'Actions for Inherits both', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(
    dialog.getByLabel('Translation language', { exact: true }).locator('option[value=""]'),
  ).toHaveCount(1);
});
