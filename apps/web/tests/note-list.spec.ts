import { expect, test } from '@playwright/test';

import {
  manyDecks,
  manyNotes,
  useFixtures as installFixtures,
  usePreferences as installPreferences,
} from './fixtures';
import { continuousSearch } from './search-interaction';

import type { Page, Route } from '@playwright/test';

async function installCategoriesFixture(page: Page) {
  const notes = manyNotes(6000).map((note, index) => ({
    ...note,
    deckId: `deck_${index % 60}`,
    rank: index,
    tags: ['shared', 'shared', `topic ${String(index % 320).padStart(3, '0')}`],
    source: index % 2 ? 'Course' : 'course',
  }));
  const requests: URL[] = [];
  await installPreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
  await installFixtures(page, {
    notes: [],
    decks: manyDecks(60).map((deck, index) => ({ ...deck, id: `deck_${index}` })),
  });
  await page.route('**/api/notes/categories?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const params = url.searchParams;
    const counts = new Map<string, number>();
    for (const note of notes)
      for (const value of params.get('kind') === 'tag' ? new Set(note.tags) : [note.source])
        if (value.toLowerCase().includes(params.get('search')?.toLowerCase() ?? ''))
          counts.set(value, (counts.get(value) ?? 0) + 1);
    const all = [...counts]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([value, count]) => ({ value, count }));
    const after = all.filter((row) => !params.has('cursor') || row.value > params.get('cursor')!);
    const items = after.slice(0, 100);
    await route.fulfill({
      json: {
        items,
        total: all.length,
        ...(after.length > 100 ? { nextCursor: items.at(-1)!.value } : {}),
      },
    });
  });
  await page.route('**/api/notes?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const params = url.searchParams;
    const matching = notes.filter(
      (note) =>
        (!params.has('tag') || note.tags.includes(params.get('tag')!)) &&
        (!params.has('source') || note.source === params.get('source')) &&
        (!params.has('search') ||
          JSON.stringify(note.fields).toLowerCase().includes(params.get('search')!.toLowerCase())),
    );
    const offset = Number(params.get('cursor') ?? 0);
    await route.fulfill({
      json: {
        items: matching.slice(offset, offset + 1000),
        ...(offset + 1000 < matching.length ? { nextCursor: String(offset + 1000) } : {}),
      },
    });
  });
  await page.route(/\/api\/notes\/note_\d+$/, (route) =>
    route.fulfill({
      json: {
        note: notes.find((note) => route.request().url().endsWith(`/${note.id}`)),
        cards: [],
      },
    }),
  );
  return { notes, requests };
}

test('Tags & Sources opens exact Note filters and preserves search, sort and Back state', async ({
  page,
}, info) => {
  const { requests } = await installCategoriesFixture(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'Tags & Sources', exact: true }).click();
  await expect(page.getByText('Shown: 100 of 321', { exact: true })).toBeVisible();
  expect(requests.every((url) => url.pathname.endsWith('/categories'))).toBe(true);
  await page.screenshot({ path: info.outputPath('tags-sources.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'shared Notes: 6000', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    'shared',
  );
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await search.fill('word');
  await page.getByRole('combobox', { name: 'Order', exact: true }).selectOption('rank');
  await expect
    .poll(() =>
      requests
        .filter((url) => url.pathname.endsWith('/notes'))
        .at(-1)
        ?.searchParams.get('sort'),
    )
    .toBe('rank');
  await page.getByRole('button', { name: /^Wort 1 word 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find Notes', exact: true }).click();
  await expect(search).toHaveValue('word');
  await expect(page.getByRole('combobox', { name: 'Order', exact: true })).toHaveValue('rank');
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    'shared',
  );
  await page.getByRole('button', { name: 'Tags & Sources', exact: true }).click();
  await page.getByText('Sources', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Course Notes: 3000', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'course Notes: 3000', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Course Notes: 3000', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Import source name', exact: true })).toHaveValue(
    'Course',
  );
  await expect(page.getByRole('button', { name: /^Wort 2 word 2/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Wort 1 word 1/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Import source name', exact: true }).fill('course');
  await expect(page.getByRole('button', { name: /^Wort 1 word 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tags & Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Course Notes: 3000', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Import source name', exact: true })).toHaveValue(
    'Course',
  );
});

test('category pagination and keyboard return keep a measured, bounded mobile list', async ({
  page,
}) => {
  const { requests } = await installCategoriesFixture(page);
  await page.goto('/library/categories');
  const search = page.getByRole('searchbox', { name: 'Search tags and sources', exact: true });
  expect(await search.evaluate((node) => getComputedStyle(node).fontSize)).toBe('16px');
  await search.fill('topic');
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  await expect(page.getByText('Shown: 100 of 320', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(page.getByText('Shown: 200 of 320', { exact: true })).toBeVisible();
  expect(requests.some((url) => url.searchParams.get('cursor') === 'topic 099')).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const row = page.getByRole('button', { name: /^topic 199 Notes:/ });
  await row.focus();
  await row.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    'topic 199',
  );
  await page.getByRole('button', { name: 'Tags & Sources', exact: true }).click();
  await expect(search).toHaveValue('topic');
  await expect(row).toBeFocused();
  expect(await page.getByRole('listitem').count()).toBeLessThan(40);
  await search.fill('missing category');
  await search.press('Enter');
  await expect(page.getByText('No matching categories', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('long saved sources and padded tags remain exact and wrap on a phone', async ({
  page,
}, info) => {
  const { notes, requests } = await installCategoriesFixture(page);
  const source = ` ${'Very long source '.repeat(11)}`.slice(0, 199) + ' ';
  notes[0]!.source = source;
  notes[0]!.tags = [' padded tag '];
  for (let i = 1; i < notes.length; i++)
    notes[i]!.source = `local:${String(i % 320).padStart(3, '0')}`;
  await page.goto('/library/categories');
  await page.getByText('Sources', { exact: true }).click();
  await page.getByRole('searchbox').fill('Very long');
  await expect(page.getByRole('button', { name: /Very long source.*Notes: 1/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('long-source.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Very long source.*Notes: 1/ }).click();
  await expect(page.getByRole('textbox', { name: 'Import source name', exact: true })).toHaveValue(
    source,
  );
  await expect
    .poll(() =>
      requests
        .filter((url) => url.pathname.endsWith('/notes'))
        .at(-1)
        ?.searchParams.get('source'),
    )
    .toBe(source);
  await page.getByRole('button', { name: 'Tags & Sources', exact: true }).click();
  await page.getByText('Tags', { exact: true }).click();
  await page.getByRole('searchbox').fill('padded');
  await page.getByRole('button', { name: 'padded tag Notes: 1', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    ' padded tag ',
  );
  await expect(page.getByRole('button', { name: /^Wort 1 word 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tags & Sources', exact: true }).click();
  await page.getByText('Sources', { exact: true }).click();
  await page.getByRole('searchbox').fill('local:');
  await expect(page.getByText('Shown: 100 of 320', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(page.getByText('Shown: 200 of 320', { exact: true })).toBeVisible();
  expect(requests.some((url) => url.searchParams.get('cursor') === 'local:099')).toBe(true);
});

for (const theme of ['dark', 'light']) {
  test(`virtual notes keep selection and refresh content in ${theme}`, async ({ page }) => {
    const notes = manyNotes(5000);
    let changed = false;
    let confirmStatus!: () => void;
    let statusRequested!: () => void;
    const statusConfirmation = new Promise<void>((resolve) => {
      confirmStatus = resolve;
    });
    const statusRequest = new Promise<void>((resolve) => {
      statusRequested = resolve;
    });

    await installPreferences(page, { theme, locale: 'en', glassScope: 'floating' });
    await installFixtures(page, { notes });
    await page.route('**/api/notes/status', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ ids: ['note_0'], status: 'known' });
      statusRequested();
      await statusConfirmation;
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
    await page.getByRole('button', { name: 'Select notes', exact: true }).click();
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

    await page.getByRole('button', { name: 'Already know these', exact: true }).click();
    await statusRequest;
    await expect(page.getByRole('button', { name: /^Wort 1 word 1 Known/ })).toBeVisible();
    confirmStatus();
    const updated = page.getByRole('button', { name: /^Updated word Updated meaning Known/ });
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

  await installPreferences(page, { theme: 'dark', locale: 'en', glassScope: 'floating' });
  await installFixtures(page, { notes: [] });
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
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Import source name', exact: true });
  await source.fill(' Import A ');

  const alphaRow = page.getByRole('button', { name: /^Alpha First source/ });
  await expect(alphaRow).toBeVisible();
  await expect(alphaRow.getByText('Partly started', { exact: true })).toBeVisible();
  await expect(alphaRow.locator('[aria-label="New cards: 2, Learning cards: 1"]')).toHaveCount(1);
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

/** A paginated account, with identical Deck names under different Folders. */
async function installFindNotesFixture(page: Page, count = 6000) {
  const leaves = manyDecks(60).map((deck, index) => ({
    ...deck,
    name: `Lesson ${index + 1}`,
    parentId: index % 2 ? 'nested' : 'root',
    path: index % 2 ? ['root', 'nested'] : ['root'],
  }));
  const root = {
    ...leaves[0],
    id: 'root',
    kind: 'folder',
    name: 'Languages',
    parentId: null,
    path: [],
    children: [
      {
        ...leaves[0],
        id: 'nested',
        kind: 'folder',
        name: 'German',
        parentId: 'root',
        path: ['root'],
        children: leaves.filter((_, at) => at % 2),
      },
      ...leaves.filter((_, at) => at % 2 === 0),
    ],
  };
  const notes = manyNotes(count).map((note, index) => ({
    ...note,
    deckId: `deck_${index % 60}`,
    rank: index,
    tags: ['lesson'],
    source: 'Frequency list',
  }));
  await installPreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
  await installFixtures(page, { notes: [], decks: [root] });
  const requests: URL[] = [];
  const state = { hold: false, held: undefined as Route | undefined };
  await page.route('**/api/notes?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (state.hold) {
      state.held = route;
      return;
    }
    const query = url.searchParams;
    const matching = notes.filter((note) => {
      const search = query.get('search')?.toLowerCase();
      return (
        (!search || JSON.stringify(note.fields).toLowerCase().includes(search)) &&
        (!query.has('tag') || query.get('tag') === 'lesson') &&
        (!query.has('source') || query.get('source') === 'Frequency list') &&
        (!query.has('status') || query.get('status') === 'active')
      );
    });
    const offset = Number(query.get('cursor') ?? 0);
    await route.fulfill({
      json: {
        items: matching.slice(offset, offset + 1000),
        ...(offset + 1000 < matching.length ? { nextCursor: String(offset + 1000) } : {}),
      },
    });
  });
  await page.route(/\/api\/notes\/note_\d+$/, (route) => {
    const note = notes.find((note) => route.request().url().endsWith(`/${note.id}`));
    return route.fulfill({ json: { note, cards: [] } });
  });
  return { requests, state };
}

test('Find Notes searches every Deck and returns with filters, sorting and list position intact', async ({
  page,
}, info) => {
  const { requests } = await installFindNotesFixture(page);
  await page.goto('/library?folderId=nested');
  await page.getByRole('button', { name: 'Find Notes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find Notes', exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await search.fill('word');
  await expect.poll(() => requests.at(-1)?.searchParams.get('search')).toBe('word');
  await expect(
    page.getByRole('button', { name: /^Wort 1 word 1 · Lesson 1 · Languages/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Wort 2 word 2 · Lesson 2 · Languages \/ German/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('find-notes-results.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('combobox', { name: 'Study participation' }).selectOption('active');
  await page.getByRole('combobox', { name: 'Card progress' }).selectOption('new');
  await page.getByRole('combobox', { name: 'Order' }).selectOption('rank');
  await page.getByRole('combobox', { name: 'Tag or topic', exact: true }).fill('lesson');
  await page
    .getByRole('textbox', { name: 'Import source name', exact: true })
    .fill('Frequency list');
  await expect.poll(() => requests.at(-1)?.searchParams.get('source')).toBe('Frequency list');
  expect(requests.at(-1)?.searchParams.get('deckId')).toBeNull();
  expect(requests.every((url) => url.searchParams.get('limit') === '1000')).toBe(true);
  await page.screenshot({ path: info.outputPath('find-notes.png'), animations: 'disabled' });
  await expect(search).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.scrollTo(0, 4000));
  const visibleTerm = () =>
    page.locator('[data-rows] [data-row]').evaluateAll((rows) => {
      const row = rows.find((node) => {
        const box = node.getBoundingClientRect();
        return box.top >= 0 && box.bottom < innerHeight - 120;
      });
      return row?.querySelector('span span')?.textContent;
    });
  await expect.poll(visibleTerm).not.toBe('Wort 1');
  await expect.poll(visibleTerm).toBeTruthy();
  const term = await visibleTerm();
  expect(term).toBeTruthy();
  const position = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: new RegExp(`^${term} word`) }).click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find Notes', exact: true }).click();
  await expect(search).toHaveValue('word');
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    'lesson',
  );
  await expect(page.getByRole('textbox', { name: 'Import source name', exact: true })).toHaveValue(
    'Frequency list',
  );
  await expect(page.getByRole('combobox', { name: 'Study participation' })).toHaveValue('active');
  await expect(page.getByRole('combobox', { name: 'Card progress' })).toHaveValue('new');
  await expect(page.getByRole('combobox', { name: 'Order' })).toHaveValue('rank');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  const reopened = page.getByRole('button', { name: new RegExp(`^${term} word`) });
  await reopened.click({ trial: true });
  const secondPosition = await page.evaluate(() => scrollY);
  await reopened.click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('word');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(secondPosition, 0);
  expect(await page.locator('[data-rows] [data-row]').count()).toBeLessThan(60);
  // Fetch further pages only as the learner reaches the existing boundary.
  await page.evaluate(() => window.scrollTo(0, 75_000));
  await expect
    .poll(() => requests.some((url) => url.searchParams.get('cursor') === '1000'))
    .toBe(true);
});

test('Find Notes stays usable during slow and empty searches and supports the phone keyboard', async ({
  page,
}) => {
  const { requests, state } = await installFindNotesFixture(page, 3);
  state.hold = true;
  await page.goto('/notes');
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await expect(search).toBeVisible();
  await search.focus();
  expect(await search.evaluate((node) => getComputedStyle(node).fontSize)).toBe('16px');
  await expect(search).toHaveAttribute('enterkeyhint', 'search');
  await expect(search).toHaveAttribute('maxlength', '100');
  await search.pressSequentially('absent', { delay: 25 });
  await expect(search).toHaveValue('absent');
  await expect.poll(() => requests.at(-1)?.searchParams.get('search')).toBe('absent');
  expect(
    requests
      .filter((url) => url.searchParams.has('search'))
      .map((url) => url.searchParams.get('search')),
  ).toEqual(['absent']);
  await expect(search).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Updating' })).toBeVisible();
  state.hold = false;
  await state.held!.fulfill({ json: { items: [] } });
  await expect(page.getByText('Nothing matches', { exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  await page.setViewportSize({ width: 375, height: 420 });
  await search.fill('word 2');
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  await expect(page.getByRole('button', { name: /^Wort 2 word 2/ })).toBeVisible();
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Order' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^Clear/ }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Wort 1 word 1/ })).toBeVisible();
});

for (const path of [
  '/notes',
  '/notes?deckId=d3',
  '/library/find',
  '/library/categories',
  '/library/duplicates',
  '/library/deleted',
]) {
  test(`continuous search keeps focus and the screen at ${path}`, async ({ page }) => {
    await installPreferences(page, { locale: 'en', theme: 'dark' });
    await installFixtures(page, { notes: manyNotes(1000) });
    await page.route('**/api/notes/categories?*', (route) =>
      route.fulfill({ json: { items: [], total: 0 } }),
    );
    await continuousSearch(
      page,
      await (async () => {
        await page.goto(path);
        return page.getByRole('searchbox').first();
      })(),
      'Wort',
    );
  });
}

test('slow superseded search responses never interrupt editing or replace the newer results', async ({
  page,
}) => {
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  const notes = manyNotes(6000);
  await installFixtures(page, { notes: [], collectionDownload: false });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/notes?*', async (route) => {
    const search = new URL(route.request().url()).searchParams.get('search') ?? '';
    if (search === 'Wort') await held;
    const matches = notes.filter((note) =>
      String((note.fields as Record<string, unknown>).term).includes(search),
    );
    await route.fulfill({ json: { items: matches.slice(0, 50) } }).catch(() => {});
  });
  await page.goto('/notes');
  const input = page.getByRole('searchbox');
  const pending = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get('search') === 'Wort',
  );
  await continuousSearch(page, input, 'Wort');
  await pending;
  await page.keyboard.type(' 2999');
  await expect(page.getByRole('button', { name: /^Wort 2999 word 2999/ })).toBeVisible();
  release();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Wort 2999');
  await expect(page.getByRole('button', { name: /^Wort 1 word 1/ })).toHaveCount(0);
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await page.keyboard.type('Wort 12');
  await expect(input).toBeFocused();
  await expect(page.getByRole('button', { name: /^Wort 12 word 12/ })).toBeVisible();
});

test('empty search results preserve the focused field position after native focus scrolling', async ({
  page,
}) => {
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  await installFixtures(page, { notes: manyNotes(1000), collectionDownload: false });
  await page.route('**/api/notes?*', (route) =>
    route.fulfill({
      json: {
        items: new URL(route.request().url()).searchParams.has('search') ? [] : manyNotes(1000),
      },
    }),
  );
  await page.goto('/notes?deckId=d3');
  const input = page.getByRole('searchbox');
  await input.click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--keyboard-inset', '336px');
    document.documentElement.dataset['keyboard'] = 'open';
  });
  await input.evaluate((node) =>
    window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 24),
  );
  const top = (await input.boundingBox())!.y;
  await page.keyboard.type('no matches');
  await expect(page.getByText('Nothing matches', { exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  // Safari pans its visual viewport independently while the keyboard remains open.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', {
      configurable: true,
      value: innerHeight - 336,
    });
    Object.defineProperty(window.visualViewport!, 'offsetTop', { configurable: true, value: 200 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(Math.abs((await input.boundingBox())!.y - top)).toBeLessThan(2);
});
