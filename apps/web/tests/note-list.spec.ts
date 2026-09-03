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
    const first = page.getByRole('button', { name: /^Wort 1 word 1/ });
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
    const updated = page.getByRole('button', { name: /^Updated word Updated meaning · Known/ });
    await expect(updated).toBeVisible();
    await expect(first).toHaveCount(0);
    await updated.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notes\/note_0$/);
  });
}

test('source filtering and card summaries stay bounded', async ({ page }) => {
  const notes = manyNotes(1200);
  const alpha = {
    ...notes[0],
    fields: { term: 'Alpha', translation: 'First source' },
    source: 'Import A',
    cardStates: { new: 2, learning: 1, review: 0, relearning: 0 },
  };
  const empty = {
    ...notes[1],
    fields: { term: 'Empty', translation: 'No live cards' },
    source: 'Import A',
    cardStates: { new: 0, learning: 0, review: 0, relearning: 0 },
  };
  const beta = {
    ...notes[2],
    fields: { term: 'Beta', translation: 'Second source' },
    source: 'Import B',
    cardStates: { new: 0, learning: 0, review: 1, relearning: 0 },
  };
  const requests: URL[] = [];

  await usePreferences(page, { theme: 'dark', locale: 'en', glassScope: 'floating' });
  await useFixtures(page, { notes: [] });
  await page.route('**/api/notes?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const source = url.searchParams.get('source');
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const cardState = url.searchParams.get('cardState');
    const matching = (
      source === 'Import A' ? [alpha, empty] : source === 'Import B' ? [beta] : [alpha, empty, beta]
    )
      .filter(
        (note) =>
          !search ||
          `${note.fields.term} ${note.fields.translation}`.toLowerCase().includes(search),
      )
      .filter(
        (note) => !cardState || note.cardStates[cardState as keyof typeof note.cardStates] > 0,
      );
    const cursor = url.searchParams.get('cursor');

    await route.fulfill({
      json: {
        items: cursor ? matching.slice(1) : matching.slice(0, 1),
        nextCursor: !cursor && matching.length > 1 ? 'next-page' : undefined,
      },
    });
  });

  await page.goto('/notes?deckId=d1');
  const source = page.getByRole('textbox', { name: 'Source', exact: true });
  await source.fill(' Import A ');

  const alphaRow = page.getByRole('button', { name: /^Alpha First source/ });
  await expect(alphaRow).toBeVisible();
  await expect(alphaRow.getByText('Mixed · 3', { exact: true })).toBeVisible();
  await expect(alphaRow.locator('[aria-label="2 New, 1 Learning"]')).toHaveCount(1);
  expect((await alphaRow.boundingBox())?.height).toBe(52);
  await expect
    .poll(() => requests.some((request) => request.searchParams.get('cursor') === 'next-page'))
    .toBe(true);
  await expect(page.getByRole('button', { name: /^Empty No live cards/ })).toBeVisible();

  await source.fill('Import B');
  await expect(page.getByRole('button', { name: /^Beta Second source/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('beta');
  await expect.poll(() => requests.at(-1)?.searchParams.get('search')).toBe('beta');
  expect(requests.at(-1)?.searchParams.get('source')).toBe('Import B');

  await page.getByRole('button', { name: /^Clear/ }).click();
  await expect(alphaRow).toBeVisible();
  await expect(source).toHaveValue('');
  expect(requests.some((request) => request.searchParams.get('source') === null)).toBe(true);
  expect(requests.every((request) => request.pathname === '/api/notes')).toBe(true);
  expect(requests.length).toBeLessThan(8);
});
