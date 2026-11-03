import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures, usePreferences as installPreferences } from './fixtures';
import {
  installInteractionMetrics,
  readInteractionMetrics,
  startInteractionMetrics,
} from './interaction-metrics';

import type { Page } from '@playwright/test';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-11-03T00:00:00.000Z';
const deckId = id(2);
const folder = {
  id: id(1),
  name: 'Vocabulary / Источники',
  kind: 'folder',
  parentId: null,
  position: 0,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
};
const decks = [
  folder,
  {
    ...folder,
    id: deckId,
    name: 'Lesson A with a long collection name',
    kind: 'deck',
    parentId: folder.id,
    rev: 2,
  },
  { ...folder, id: id(3), name: 'Lesson B', kind: 'deck', rev: 3 },
];
function note(at: number, term: string) {
  return {
    id: id(100 + at),
    deckId: at % 2 ? deckId : id(3),
    noteType: 'vocab',
    fields: {
      term,
      translation: at % 2 ? 'Берег реки / river edge' : 'Financial institution / банк',
    },
    tags: [],
    source: at % 2 ? 'River lesson' : 'Oxford source',
    rank: null,
    status: 'active',
    importBatchId: null,
    createdAt: date,
    updatedAt: date,
    rev: 4 + at,
  };
}
async function fixture(page: Page, size = 6500, download = true) {
  await installPreferences(page, { locale: 'en', theme: 'dark', glassScope: 'floating' });
  await installFixtures(page);
  const state = {
    offline: false,
    who: 'duplicate-reader',
    complete: download,
    notes: Array.from({ length: size }, (_, at) =>
      note(at, at < 1500 ? 'Bank' : at < 5500 ? `Unique ${at}` : `Pair ${Math.floor(at / 2)}`),
    ),
    requests: [] as URL[],
    writes: 0,
  };
  const account = {
    id: state.who,
    name: 'Reader',
    email: 'reader@example.test',
    image: null,
    locale: 'en',
    theme: 'system',
    timezone: 'Europe/Minsk',
    dayCutoffHour: 4,
    plan: 'free',
    settings: {},
    twoFactorEnabled: false,
    revision: 4 + size,
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    state.requests.push(url);
    if (route.request().method() !== 'GET') state.writes++;
    if (state.offline) return route.abort('internetdisconnected');
    if (url.pathname === '/api/account')
      return route.fulfill({ json: { ...account, id: state.who } });
    const own = state.who === account.id;
    const visible = own ? state.notes : [];
    if (url.pathname === '/api/decks')
      return route.fulfill({
        json: {
          decks: own
            ? [
                {
                  ...folder,
                  path: [],
                  noteCount: size / 2,
                  due: 0,
                  fresh: 0,
                  children: [
                    {
                      ...decks[1],
                      path: [folder.id],
                      children: [],
                      noteCount: size / 2,
                      due: 0,
                      fresh: 0,
                    },
                  ],
                },
                { ...decks[2], path: [], children: [], noteCount: size / 2, due: 0, fresh: 0 },
              ]
            : [],
        },
      });
    if (url.pathname === '/api/sync') {
      if (!state.complete)
        return route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
      const since = Number(url.searchParams.get('since') ?? 0);
      const all = own
        ? [
            ...decks.map((row) => ({
              entity: 'decks',
              id: row.id,
              rev: row.rev,
              deleted: false,
              purged: false,
              row,
            })),
            ...visible.map((row) => ({
              entity: 'notes',
              id: row.id,
              rev: row.rev,
              deleted: false,
              purged: false,
              row,
            })),
          ]
        : [];
      const remaining = all.filter((row) => row.rev > since);
      const changes = remaining.slice(0, 200);
      return route.fulfill({
        json: {
          since,
          revision: changes.at(-1)?.rev ?? since,
          hasMore: remaining.length > changes.length,
          changes,
        },
      });
    }
    if (
      url.pathname === '/api/notes/possible-duplicates' ||
      url.pathname === '/api/notes/possible-duplicates/notes'
    ) {
      const scoped = visible.filter(
        (note) => !url.searchParams.has('deckId') || note.deckId === url.searchParams.get('deckId'),
      );
      const groups = new Map<string, typeof scoped>();
      for (const note of scoped) {
        const key = note.fields.term.toLowerCase();
        groups.set(key, [...(groups.get(key) ?? []), note]);
      }
      const cursor = url.searchParams.get('cursor');
      const limit = Number(url.searchParams.get('limit'));
      if (url.pathname.endsWith('/notes')) {
        const members = groups.get(url.searchParams.get('key')!) ?? [];
        const rows =
          members.length < 2 ? [] : members.filter((note) => !cursor || note.id > cursor);
        return route.fulfill({
          json: {
            items: rows.slice(0, limit).map((note) => ({
              ...note,
              deckPath: note.deckId === deckId ? [folder.name, decks[1]!.name] : ['Lesson B'],
            })),
            ...(rows.length > limit ? { nextCursor: rows[limit - 1]!.id } : {}),
          },
        });
      }
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const rows = [...groups.entries()]
        .filter(
          ([key, notes]) =>
            notes.length >= 2 &&
            (!cursor || key > cursor) &&
            (!search ||
              notes.some((note) =>
                `${note.fields.term} ${note.fields.translation} ${note.source}`
                  .toLowerCase()
                  .includes(search),
              )),
        )
        .map(([key, notes]) => ({ key, count: notes.length }))
        .sort((a, b) => (a.key < b.key ? -1 : 1));
      return route.fulfill({
        json: {
          items: rows.slice(0, limit),
          ...(rows.length > limit ? { nextCursor: rows[limit - 1]!.key } : {}),
        },
      });
    }
    if (url.pathname === '/api/notes')
      return route.fulfill({ json: { items: visible.slice(0, 100) } });
    const found = visible.find((note) => `/api/notes/${note.id}` === url.pathname);
    if (found) return route.fulfill({ json: { note: found, cards: [] } });
    return route.fulfill({ json: {} });
  });
  return state;
}
async function downloaded(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'What works offline', exact: true }).click();
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await page.goBack();
}

test('Library and Deck entries inspect groups with bounded pages and editor return', async ({
  page,
}, info) => {
  const state = await fixture(page);
  await installInteractionMetrics(page);
  await page.goto('/library');
  const started = Date.now();
  await page.getByRole('button', { name: 'Possible duplicates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'bank 1500 Notes with this term' })).toBeVisible();
  const entryMs = Date.now() - started;
  const search = page.getByRole('searchbox', { name: 'Search duplicate groups' });
  await search.fill('River');
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  await startInteractionMetrics(page);
  await page.getByRole('button', { name: 'bank 1500 Notes with this term' }).click();
  await expect(page.getByText('Oxford source', { exact: false }).first()).toBeVisible();
  await expect(
    page
      .locator('[data-duplicate-rows]')
      .getByText('Vocabulary / Источники / Lesson A with a long collection name')
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Берег реки / river edge', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 3000));
  let rowId: string | undefined;
  await expect
    .poll(async () => {
      rowId = await page.locator('[data-duplicate-id]').evaluateAll((nodes) => {
        const row = nodes.find((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.top >= 80 && bounds.bottom <= innerHeight - 100;
        }) as HTMLElement | undefined;
        row?.querySelector('button')?.focus({ preventScroll: true });
        return row?.dataset['duplicateId'];
      });
      return rowId;
    })
    .toBeTruthy();
  const row = page.locator(`[data-duplicate-id="${rowId}"] button`);
  await row.evaluate((node) =>
    node.addEventListener(
      'click',
      () => {
        Object.assign(window, { duplicateExitScroll: scrollY });
      },
      { once: true },
    ),
  );
  await row.press('Enter');
  const top = await page.evaluate(
    () => (window as unknown as { duplicateExitScroll: number }).duplicateExitScroll,
  );
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Possible duplicates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'bank', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(top, 0);
  await expect(page.locator(`[data-duplicate-id="${rowId}"] button`)).toBeFocused();
  expect(await page.locator('[data-duplicate-id]').count()).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect
    .poll(() =>
      state.requests.some(
        (url) =>
          url.pathname.endsWith('/possible-duplicates/notes') && url.searchParams.has('cursor'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'All groups', exact: true }).click();
  await expect(search).toHaveValue('River');
  await page.getByRole('combobox', { name: 'Collection scope' }).selectOption(deckId);
  await expect(page.getByRole('button', { name: 'bank 750 Notes with this term' })).toBeVisible();
  expect(state.writes).toBe(0);
  const metrics = await readInteractionMetrics(page);
  await info.attach('duplicate-interactions.json', {
    body: JSON.stringify({ entryMs, ...metrics }),
    contentType: 'application/json',
  });
  expect(entryMs).toBeLessThan(3000);
});

test('group pagination and large member lists stay virtual with long mobile content', async ({
  page,
}, info) => {
  const state = await fixture(page);
  state.notes[0]!.fields = { term: 'Bank', translation: 'Очень длинный перевод '.repeat(40) };
  await page.goto('/library/duplicates');
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect
    .poll(() =>
      state.requests.some(
        (url) => url.pathname.endsWith('/possible-duplicates') && url.searchParams.has('cursor'),
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'bank 1500 Notes with this term' }).click();
  await expect(page.getByText(/Очень длинный перевод/).first()).toBeVisible();
  await expect(page.locator('[data-duplicate-id]')).not.toHaveCount(0);
  expect(await page.locator('[data-duplicate-id]').count()).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('duplicates-mobile.png'), fullPage: false });
  expect(state.requests.filter((url) => /cards|\/notes\?/.test(url.pathname)).length).toBe(0);
});

test('complete downloads support offline inspection, local edits, pending Notes and reconnection', async ({
  page,
}, info) => {
  test.setTimeout(210_000);
  const state = await fixture(page);
  await installInteractionMetrics(page);
  await page.goto('/library/duplicates');
  await downloaded(page);
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  const start = Date.now();
  await startInteractionMetrics(page);
  await expect(page.getByText(/Complete downloaded collection/)).toBeVisible();
  await page.getByRole('button', { name: 'bank 1500 Notes with this term' }).click();
  await expect(page.getByRole('heading', { name: 'bank', exact: true })).toBeVisible();
  const offlineMs = Date.now() - start;
  const metrics = await readInteractionMetrics(page);
  expect(metrics.scans['cards'] ?? 0).toBe(0);
  await info.attach('duplicate-offline-performance.json', {
    body: JSON.stringify({ offlineMs, ...metrics }),
    contentType: 'application/json',
  });
  await page.locator('[data-duplicate-id] button').first().click();
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  const term = page.getByRole('textbox', { name: 'Word', exact: true });
  await term.fill('Unique edited term');
  await page.getByRole('button', { name: 'Possible duplicates', exact: true }).click();
  await page.getByRole('button', { name: 'All groups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'bank 1499 Notes with this term' })).toBeVisible();
  state.offline = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText(/^Server results/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'bank 1500 Notes with this term' })).toBeVisible();
});

test('incomplete downloads cannot supply offline groups and account switching clears results', async ({
  page,
}) => {
  const state = await fixture(page, 10, false);
  await page.goto('/library/duplicates');
  await expect(page.getByRole('button', { name: 'bank 10 Notes with this term' })).toBeVisible();
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(
    page.getByText('The collection download is incomplete or missing.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('[data-duplicate-id]')).toHaveCount(0);
  state.offline = false;
  state.who = 'second-account';
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText('No matching groups', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: /^bank / })).toHaveCount(0);
});

test('device-only Notes are labeled in complete downloaded groups', async ({ page }) => {
  const state = await fixture(page, 2);
  await page.goto('/notes?deckId=' + deckId);
  await downloaded(page);
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Bank');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('Device-only meaning');
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Possible duplicates', exact: true }).click();
  await page.getByRole('button', { name: 'bank 3 Notes with this term' }).click();
  const pending = page.getByRole('button', { name: /Bank Device-only meaning/ });
  await expect(pending).toContainText('Saved on device');
  expect(state.writes).toBe(0);
});
