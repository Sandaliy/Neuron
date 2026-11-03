import { expect, test } from '@playwright/test';

import {
  manyDecks,
  manyNotes,
  useFixtures as installFixtures,
  usePreferences as installPreferences,
} from './fixtures';

import type { Page } from '@playwright/test';

const leaf = {
  id: 'leaf',
  name: 'Words for everyday conversations',
  kind: 'deck',
  parentId: 'folder',
  path: ['folder'],
  children: [],
  due: 2,
  fresh: 3,
  noteCount: 8,
  settings: { targetLanguage: 'de' },
};
const folder = {
  ...leaf,
  id: 'folder',
  name: 'German',
  kind: 'folder',
  parentId: null,
  path: [],
  children: [leaf],
};
const other = {
  ...leaf,
  id: 'other',
  name: 'English',
  parentId: null,
  path: [],
  settings: { targetLanguage: 'en' },
};
const states = [
  { new: 3, learning: 0, review: 0, relearning: 0 },
  { new: 1, learning: 0, review: 2, relearning: 0 },
  { new: 0, learning: 1, review: 2, relearning: 0 },
  { new: 0, learning: 0, review: 2, relearning: 1 },
  { new: 0, learning: 0, review: 3, relearning: 0 },
  { new: 0, learning: 0, review: 0, relearning: 0 },
];
const labels = [
  'New',
  'Partly started',
  'Learning',
  'Learning',
  'Practiced',
  'No cards',
  'Known',
  'Set aside',
];
const notes = manyNotes(8).map((note, index) => ({
  ...note,
  deckId: leaf.id,
  fields: { term: `Example ${index + 1}`, translation: 'Separate learning directions' },
  cardStates: states[index] ?? states[4],
  status: index === 6 ? 'known' : index === 7 ? 'suspended' : 'active',
}));

for (const theme of ['light', 'dark'] as const) {
  test(`hierarchy, destinations and truthful progress in ${theme}`, async ({ page }, info) => {
    await installPreferences(page, { theme, locale: 'en' });
    await installFixtures(page, { decks: [folder, other], notes });
    await page.route('**/api/decks/leaf/practice', (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.goto('/library');
    await expect(page.getByText('1 deck · 8 notes')).toBeVisible();
    await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /^Words for everyday conversations/ }),
    ).toContainText('8 notes');
    await page
      .getByRole('button', { name: /Actions for Words for everyday conversations/ })
      .click();
    await expect(page.getByText('Cards: 2 due · 3 new')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: info.outputPath('hierarchy.png'),
      animations: 'disabled',
      fullPage: true,
    });
    await page.getByRole('button', { name: /^Words for everyday conversations/ }).click();
    for (const [index, label] of labels.entries()) {
      const row = page.getByRole('button', { name: new RegExp(`^Example ${index + 1} `) });
      await expect(row.getByText(label, { exact: true })).toBeVisible();
      expect((await row.boundingBox())?.height).toBe(52);
    }
    await expect(page.locator('[aria-label="New cards: 1, Practiced cards: 2"]')).toBeVisible();
    await expect(page.locator('[aria-label="Practiced cards: 3"]')).toBeVisible();
    await expect(page.getByText(/Mixed|In review|due now/)).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('progress.png'),
      animations: 'disabled',
      fullPage: true,
    });

    await page.goto('/import?deckId=leaf');
    await page.getByText('Change destination', { exact: true }).click();
    await page.getByRole('button', { name: 'Import into', exact: true }).click();
    const picker = page.getByRole('dialog');
    const chosen = picker.getByRole('button', { name: /^Words for everyday conversations/ });
    await expect(chosen).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.getByRole('button', { name: 'German', exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await chosen.focus();
    await expect(chosen).toBeFocused();
    expect(await chosen.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
    await page.screenshot({ path: info.outputPath('destination.png'), animations: 'disabled' });
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('English');
    await expect(picker.getByRole('button', { name: /^German/ })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'English', exact: true })).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('missing');
    await expect(picker.getByRole('status')).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('German');
    await expect(chosen).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('');
    await picker.getByRole('button', { name: 'German', exact: true }).click();
    await expect(chosen).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'German', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await picker.getByRole('button', { name: 'German', exact: true }).click();
    await chosen.focus();
    await page.keyboard.press('Enter');
    await expect(picker).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('missing progress counts do not claim there are no Cards', async ({ page }) => {
  const note = { ...notes[0], cardStates: undefined };
  await installPreferences(page, { theme: 'light', locale: 'en' });
  await installFixtures(page, { decks: [folder], notes: [note] });
  await page.goto('/notes?deckId=leaf');
  await expect(
    page.getByRole('button', { name: /^Example 1/ }).getByText('Studying'),
  ).toBeVisible();
  await expect(page.getByText('No cards', { exact: true })).toHaveCount(0);
});

const findCollections = 'Find Folders & Decks';
async function collectionSearchFixture(page: Page, count = 2) {
  const leaves = manyDecks(count).map((row, at) => ({
    ...row,
    id: `lesson-${at}`,
    name: at === 0 ? 'Lesson' : `Lesson ${at + 1}`,
    parentId: 'nested',
    path: ['folder', 'nested'],
  }));
  const nested = {
    ...folder,
    id: 'nested',
    name: 'Nested folder',
    parentId: 'folder',
    path: ['folder'],
    children: leaves,
  };
  const roots = [
    { ...folder, children: [nested] },
    { ...other, id: 'root-lesson', name: 'Lesson' },
  ];
  await installPreferences(page, { theme: 'light', locale: 'en' });
  await installFixtures(page, { decks: roots, notes: [] });
  await page.route('**/api/decks/*/practice', (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  return roots;
}

test('collection search reaches collapsed descendants, distinguishes names and preserves Library disclosure state', async ({
  page,
}, info) => {
  const roots = await collectionSearchFixture(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/library');
  const disclosure = page.getByRole('button', { name: 'Show what is inside', exact: true });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: findCollections, exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search collection names' });
  await search.fill(' LESSON ');
  await expect(page.getByRole('status').filter({ hasText: '3 of 5 collections' })).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Lesson Deck · Library / German / Nested folder',
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Lesson Deck · Library', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('collection-search-duplicates.png'),
    animations: 'disabled',
  });
  await search.fill('nested');
  const result = page.getByRole('button', {
    name: 'Nested folder Folder · Library / German',
    exact: true,
  });
  await result.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/library\?folderId=nested$/);
  await page.getByRole('button', { name: 'Search results', exact: true }).click();
  await expect(search).toHaveValue('nested');
  await expect(result).toBeFocused();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Find Notes', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  // Current tree revisions own visibility and location; old matches are never retained.
  roots[0]!.name = 'Renamed parent';
  roots[0]!.children = [
    { ...roots[0]!.children[0]!, children: [roots[0]!.children[0]!.children[0]!] },
  ];
  await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: roots } }));
  await page.reload();
  await page.getByRole('button', { name: findCollections, exact: true }).click();
  await search.fill('Lesson');
  await expect(page.getByRole('status').filter({ hasText: '2 of 4 collections' })).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Lesson Deck · Library / Renamed parent / Nested folder',
      exact: true,
    }),
  ).toBeVisible();
});

test('large collection search returns from a Deck with the query, measured scroll and keyboard focus intact', async ({
  page,
}) => {
  await collectionSearchFixture(page, 2500);
  await page.goto('/library?folderId=nested');
  await page.getByRole('button', { name: findCollections, exact: true }).click();
  const search = page.getByRole('searchbox');
  await search.fill('lesson');
  await expect(
    page.getByRole('status').filter({ hasText: '2501 of 2503 collections' }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 6000));
  const results = page.getByRole('list', { name: findCollections });
  const visible = results.getByRole('button').filter({ visible: true });
  const row = visible.nth(6);
  await row.focus();
  const position = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/notes\?deckId=lesson-/);
  await page.getByRole('button', { name: 'Search results', exact: true }).click();
  await expect(search).toHaveValue('lesson');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  await expect(results.locator('button:focus')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(results.locator('button:focus')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/notes\?deckId=lesson-/);
  await page.goBack();
  await expect(search).toHaveValue('lesson');
  expect(await results.getByRole('listitem').count()).toBeLessThan(40);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library\?folderId=nested$/);
});

test('collection search wraps complete Cyrillic paths and supports empty results and the phone keyboard', async ({
  page,
}, info) => {
  await installFixtures(page);
  const long = 'Очень длинное название папки без сокращения '.repeat(3);
  let nested: Record<string, unknown> = { ...other, id: 'target', name: 'Колода' };
  for (let depth = 0; depth < 7; depth++)
    nested = { ...folder, id: `long-${depth}`, name: `${depth} ${long}`, children: [nested] };
  await installPreferences(page, { theme: 'dark', locale: 'ru' });
  await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [nested] } }));
  await page.goto('/library/find');
  const search = page.getByRole('searchbox', { name: 'Search collection names' });
  await search.fill('колода');
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  const result = page.getByRole('listitem');
  await expect(result).toContainText(`0 ${long.trim()}`);
  await expect(result).toContainText(`6 ${long.trim()}`);
  expect(await result.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('collection-search-long-path.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await search.fill('absent');
  await expect(page.getByText('No collections match', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('status').filter({ hasText: '8 of 8 collections' })).toBeVisible();
});

test('collection search shows loading, read errors and a retry without losing the query', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'light', locale: 'en' });
  await installFixtures(page, { collectionDownload: false });
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failed = true;
  await page.route('**/api/decks', async (route) => {
    await wait;
    return failed
      ? route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } })
      : route.fulfill({ json: { decks: [other] } });
  });
  await page.goto('/library/find');
  const search = page.getByRole('searchbox');
  await search.fill('English');
  await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
  release!();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'English Deck · Library', exact: true }),
  ).toBeVisible();
  await expect(search).toHaveValue('English');
});

test('collection search explains an incomplete offline download without presenting cached online results as downloaded', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'light', locale: 'en' });
  await installFixtures(page, { decks: [other], collectionDownload: false });
  await page.goto('/library/find');
  const search = page.getByRole('searchbox');
  await search.fill('English');
  await expect(
    page.getByRole('button', { name: 'English Deck · Library', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(
    page.getByText(
      'The collection download is incomplete or missing. Connect and sign in to finish downloading before browsing offline.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(search).toHaveValue('English');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText(/Searching the downloaded Library/)).toHaveCount(0);
});
