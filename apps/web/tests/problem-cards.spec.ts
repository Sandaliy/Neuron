import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures, usePreferences as installPreferences } from './fixtures';

import type { Page } from '@playwright/test';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-11-03T00:00:00.000Z';
const folder = {
  id: id(1),
  name: 'Languages',
  kind: 'folder',
  parentId: null,
  position: 0,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
};
const german = { ...folder, id: id(2), name: 'German', kind: 'deck', parentId: folder.id, rev: 2 };
const theory = { ...folder, id: id(3), name: 'Theory', kind: 'deck', rev: 3 };
const decks = [folder, german, theory];
const NOTES = 3000;
/** The first 600 Notes have a slipping recognition Card; every fifth only by frequent Again. */
const LISTED = 600;

function note(at: number) {
  return {
    id: id(1000 + at),
    deckId: at % 2 ? german.id : theory.id,
    noteType: 'vocab',
    fields: {
      term: at === 1 ? 'die Unverhältnismäßigkeit der Mittel im Verwaltungsrecht' : `Wort ${at}`,
      translation: `meaning ${at}`,
    },
    tags: [],
    source: 'Fixture',
    rank: null,
    status: 'active',
    importBatchId: null,
    createdAt: date,
    updatedAt: date,
    rev: 10 + at,
  };
}
function card(at: number, suspended: Set<string>) {
  const lapses = at < LISTED ? (at % 5 === 4 ? 1 : 3 + (at % 3)) : at % 2;
  const cardId = id(100_000 + at);
  return {
    id: cardId,
    noteId: id(1000 + at),
    deckId: at % 2 ? german.id : theory.id,
    direction: 'recognition',
    slot: 0,
    state: 'review',
    stability: 4,
    difficulty: 7,
    due: '2026-11-20T08:00:00.000Z',
    lastReview: `2026-10-${String(1 + (at % 28)).padStart(2, '0')}T08:00:00.000Z`,
    reps: 14,
    lapses,
    learningStep: 0,
    suspendedAt: suspended.has(cardId) ? date : null,
    unlockedAt: null,
    updatedAt: date,
    rev: 10 + NOTES + at,
  };
}

async function fixture(page: Page) {
  await installPreferences(page, { locale: 'en', theme: 'dark', glassScope: 'floating' });
  await installFixtures(page);
  const state = {
    offline: false,
    suspended: new Set<string>(),
    requests: [] as URL[],
    writes: [] as string[],
  };
  const notes = Array.from({ length: NOTES }, (_, at) => note(at));
  const account = {
    id: 'slipping-reader',
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
    revision: 10 + NOTES * 2,
  };
  const item = (at: number) => {
    const row = card(at, state.suspended);
    const frequent = at % 5 === 4;
    const lapses = frequent ? 1 : row.lapses;
    const again = frequent ? 6 : lapses;
    return {
      card: {
        id: row.id,
        noteId: row.noteId,
        deckId: row.deckId,
        direction: row.direction,
        slot: 0,
        state: row.state,
        due: row.due,
        suspendedAt: row.suspendedAt,
        rev: row.rev,
      },
      note: {
        id: notes[at]!.id,
        deckId: notes[at]!.deckId,
        noteType: 'vocab',
        fields: notes[at]!.fields,
        source: 'Fixture',
      },
      deckPath: at % 2 ? ['Languages', 'German'] : ['Theory'],
      reasons: frequent ? ['frequent_again'] : ['repeated_lapses'],
      evidence: {
        kind: 'history',
        answers: frequent ? 10 : 14,
        again,
        lapses,
        lastAgainAt: row.lastReview,
        lastAnsweredAt: row.lastReview,
        sinceLastAgain: at % 4,
        startedAt: at === 0 ? '2026-09-01T08:00:00.000Z' : null,
        recent: ['good', 'again', 'good', 'good', 'again', 'easy'].map((rating, step) => ({
          rating,
          reviewedAt: `2026-10-${String(20 - step).padStart(2, '0')}T08:00:00.000Z`,
          stateBefore: 'review',
        })),
      },
    };
  };
  // Matched on the path: a glob would also catch the dev server's packages/shared/src/api modules.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      state.requests.push(url);
      if (state.offline) return route.abort('internetdisconnected');
      if (url.pathname === '/api/account') return route.fulfill({ json: account });
      if (url.pathname === '/api/decks') {
        const node = (deck: (typeof decks)[number], path: string[], children: unknown[] = []) => ({
          ...deck,
          path,
          children,
          noteCount: NOTES / 2,
          due: 0,
          fresh: 0,
        });
        return route.fulfill({
          json: {
            decks: [node(folder, [], [node(german, [folder.id])]), node(theory, [])],
          },
        });
      }
      if (url.pathname === '/api/sync') {
        const since = Number(url.searchParams.get('since') ?? 0);
        const rows = [
          ...decks.map((row) => ({ entity: 'decks', id: row.id, rev: row.rev, row })),
          ...notes.map((row) => ({ entity: 'notes', id: row.id, rev: row.rev, row })),
          ...notes.map((_, at) => {
            const row = card(at, state.suspended);
            return { entity: 'cards', id: row.id, rev: row.rev, row };
          }),
        ]
          .map((row) => ({ ...row, deleted: false, purged: false }))
          .filter((row) => row.rev > since);
        const changes = rows.slice(0, 200);
        return route.fulfill({
          json: {
            since,
            revision: changes.at(-1)?.rev ?? since,
            hasMore: rows.length > changes.length,
            changes,
          },
        });
      }
      if (url.pathname === '/api/cards/problems') {
        const params = url.searchParams;
        const search = params.get('search')?.toLowerCase() ?? '';
        const all = Array.from({ length: LISTED }, (_, at) => item(at)).filter(
          (entry) =>
            (!params.has('deckId') ||
              entry.card.deckId === params.get('deckId') ||
              (params.get('deckId') === folder.id && entry.card.deckId === german.id)) &&
            (!params.has('direction') || entry.card.direction === params.get('direction')) &&
            (params.get('state') !== 'suspended' || entry.card.suspendedAt !== null) &&
            (params.get('state') !== 'studying' || entry.card.suspendedAt === null) &&
            (!search || JSON.stringify(entry.note.fields).toLowerCase().includes(search)),
        );
        if (params.get('sort') === 'recent')
          all.sort((a, b) => (a.evidence.lastAgainAt < b.evidence.lastAgainAt ? 1 : -1));
        const cursor = params.get('cursor');
        const start = cursor ? all.findIndex((entry) => entry.card.id === cursor) + 1 : 0;
        const limit = Number(params.get('limit'));
        const items = all.slice(start, start + limit);
        return route.fulfill({
          json: {
            items,
            total: all.length,
            ...(start + limit < all.length ? { nextCursor: items.at(-1)!.card.id } : {}),
          },
        });
      }
      const write = /^\/api\/cards\/([^/]+)\/(suspend|unsuspend)$/.exec(url.pathname);
      if (write && method === 'POST') {
        state.writes.push(`${write[2]}:${write[1]}`);
        if (write[2] === 'suspend') state.suspended.add(write[1]!);
        else state.suspended.delete(write[1]!);
        const at = Number(write[1]!.slice(-12)) - 100_000;
        return route.fulfill({ json: { card: card(at, state.suspended) } });
      }
      if (url.pathname === '/api/notes') {
        const scoped = notes.filter(
          (entry) =>
            !url.searchParams.has('deckId') || entry.deckId === url.searchParams.get('deckId'),
        );
        return route.fulfill({ json: { items: scoped.slice(0, 200) } });
      }
      const found = notes.findIndex((entry) => `/api/notes/${entry.id}` === url.pathname);
      if (found >= 0)
        return route.fulfill({
          json: { note: notes[found], cards: [card(found, state.suspended)] },
        });
      return route.fulfill({ json: {} });
    },
  );
  return state;
}

const rowOf = (page: Page, at: number) => page.locator(`[data-problem-id="${id(100_000 + at)}"]`);

test('Library entry explains the evidence and sets a Card aside and back in place', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'Slipping cards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Slipping cards', exact: true })).toBeVisible();
  await expect(page.getByText(/^From your answer history on the server/)).toBeVisible();
  await expect(page.getByText('Cards listed: 600', { exact: true })).toBeVisible();
  const first = rowOf(page, 0);
  await expect(first.getByText('Forgot 3 times after learning it, in 14 answers')).toBeVisible();
  await expect(first.getByText('Counted since it was started over on Sep 1')).toBeVisible();
  await expect(first.getByText('In Study, next review Nov 20')).toBeVisible();
  await expect(first.getByRole('list', { name: 'Latest answers, newest first' })).toBeVisible();
  await expect(rowOf(page, 4).getByText('Again in 6 of 10 answers')).toBeVisible();
  await expect(rowOf(page, 1).getByText(/Unverhältnismäßigkeit/)).toBeVisible();
  // Thousands of Notes, hundreds listed, a bounded page and few mounted rows.
  expect(await page.locator('[data-problem-id]').count()).toBeLessThan(20);
  const listRequest = state.requests.find((url) => url.pathname === '/api/cards/problems');
  expect(listRequest?.searchParams.get('limit')).toBe('50');

  const setAside = first.getByRole('button', { name: 'Set aside', exact: true });
  await setAside.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => window.scrollY);
  await setAside.click();
  await expect(page.getByText(/^Card set aside\. It stays out of Study/)).toBeVisible();
  await expect(
    first.getByText('Set aside since Nov 3. Its schedule and history are kept.'),
  ).toBeVisible();
  await expect(first.getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - top)).toBeLessThan(2);
  expect(state.writes).toEqual([`suspend:${id(100_000)}`]);
  // The recommendation stays: a set-aside Card keeps its evidence.
  await expect(first.getByText('Forgot 3 times after learning it, in 14 answers')).toBeVisible();

  await page.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('suspended');
  await expect(page.getByText('Cards listed: 1', { exact: true })).toBeVisible();
  await rowOf(page, 0).getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('Card back in Study', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([`suspend:${id(100_000)}`, `unsuspend:${id(100_000)}`]);
  await expect(rowOf(page, 0).getByText('In Study, next review Nov 20')).toBeVisible();
});

test('editing a Note returns to the same filters, Card and position', async ({ page }) => {
  await fixture(page);
  await page.goto('/library/slipping');
  await page.getByRole('combobox', { name: 'Order', exact: true }).selectOption('recent');
  await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('recognition');
  await expect(page.getByText('Cards listed: 600', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' }));
  await expect(page.locator('[data-problem-id][data-index="10"]')).toBeAttached();
  const cardId = await page
    .locator('[data-problem-id][data-index="10"]')
    .getAttribute('data-problem-id');
  const target = page.locator(`[data-problem-id="${cardId}"]`);
  const edit = target.getByRole('button', { name: 'Edit note', exact: true });
  await edit.scrollIntoViewIfNeeded();
  const top = await page.evaluate(() => window.scrollY);
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  for (const back of [
    () => page.getByRole('button', { name: 'Slipping cards', exact: true }).click(),
    () => page.goBack(),
  ]) {
    await back();
    await expect(page.getByRole('heading', { name: 'Slipping cards', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Order', exact: true })).toHaveValue('recent');
    await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue(
      'recognition',
    );
    const row = page.locator(`[data-problem-id="${cardId}"]`);
    await expect(row.getByRole('button', { name: 'Edit note', exact: true })).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - top)).toBeLessThan(4);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  }
});

test('a Deck entry scopes the list and returns to its Notes', async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/notes?deckId=${german.id}`);
  await page.getByRole('button', { name: 'Slipping cards', exact: true }).click();
  await expect(page.getByText('Cards listed: 300', { exact: true })).toBeVisible();
  expect(
    state.requests.some(
      (url) =>
        url.pathname === '/api/cards/problems' && url.searchParams.get('deckId') === german.id,
    ),
  ).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Collection scope', exact: true })).toHaveValue(
    german.id,
  );
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notes\\?deckId=${german.id}`));
});

test('a complete download lists lapse counts offline and never changes a Card locally', async ({
  page,
}) => {
  test.setTimeout(210_000);
  const state = await fixture(page);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'What works offline', exact: true }).click();
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await page.goto('/library');
  await expect(page.getByRole('button', { name: 'Slipping cards', exact: true })).toBeVisible();
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Slipping cards', exact: true }).click();
  await expect(
    page.getByText(/^Downloaded collection: cards forgotten 3 or more times/),
  ).toBeVisible();
  // Frequent Again needs the history: only the lapse counter is evaluated offline.
  await expect(page.getByText('Cards listed: 480', { exact: true })).toBeVisible();
  const row = page.locator('[data-problem-id]').first();
  await expect(row.getByText(/as of the last download$/)).toBeVisible();
  // The restricted action stays discoverable and explains itself; nothing is written.
  await row.getByRole('button', { name: 'Set aside', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByText('This action needs a verified connection. Try again after reconnecting.')
      .first(),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
  state.offline = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText(/^From your answer history on the server/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Cards listed: 600', { exact: true })).toBeVisible();
});
