import { expect, test } from '@playwright/test';

import {
  triageList,
  triageNotes,
  useFixtures as installFixtures,
  usePreferences as installPreferences,
} from './fixtures';

import type { Page, Request } from '@playwright/test';

/**
 * Triage of a large import, with the api answered by fixtures.
 *
 * What a person must be able to rely on: one tap decides and the next Note is
 * there, decisions travel in a few batches rather than one request each, Undo
 * and the list put any decision right, and nothing decided is lost to a reload
 * or a server that is not answering.
 */

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const words = (count: number) => triageNotes(count);

type Decision = { id: string; choice: string };

function decisionsSent(page: Page): Decision[][] {
  const sent: Decision[][] = [];
  page.on('request', (request: Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/notes/triage')
      sent.push((request.postDataJSON() as { decisions: Decision[] }).decisions);
  });
  return sent;
}

async function open(page: Page, count: number) {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page, { notes: words(count) });
  await page.goto('/notes?deckId=d5&learning=triage');
  await expect(term(page, 1)).toBeVisible();
}

const term = (page: Page, n: number) => page.getByText(`Wort ${n}`, { exact: true });
const decision = (page: Page, name: 'Known' | 'Unsure' | 'New') =>
  page.getByRole('button', { name: new RegExp(`^${name} \\d+$`) });

test('one tap decides, the next Note is there, and decisions travel in a batch', async ({
  page,
}) => {
  const sent = decisionsSent(page);
  await open(page, 3000);

  await decision(page, 'Known').click();
  await expect(term(page, 2)).toBeVisible();
  await decision(page, 'Unsure').click();
  await expect(term(page, 3)).toBeVisible();
  await decision(page, 'New').click();
  await expect(term(page, 4)).toBeVisible();

  await expect(page.getByRole('button', { name: 'Known 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unsure 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New 1', exact: true })).toBeVisible();
  await expect(page.getByText('Left: 2997', { exact: true })).toBeVisible();
  await expect(page.getByText('4 of 3000 · Rank 4', { exact: true })).toBeVisible();

  await expect.poll(() => sent.flat().length).toBe(3);
  expect(sent.flat()).toEqual([
    { id: id(1), choice: 'known' },
    { id: id(2), choice: 'unsure' },
    { id: id(3), choice: 'new' },
  ]);

  // A fast run of taps is gathered into a few requests, not one each.
  for (let n = 4; n < 34; n++) {
    await page.keyboard.press(String((n % 3) + 1));
    await expect(term(page, n + 1)).toBeVisible();
  }
  await expect.poll(() => sent.flat().length).toBe(33);
  expect(sent.length).toBeLessThan(12);
  await expect(page.getByText('Left: 2967', { exact: true })).toBeVisible();
});

test('Undo walks back through this visit and returns each Note to what it was', async ({
  page,
}) => {
  const sent = decisionsSent(page);
  await open(page, 50);
  const undo = page.getByRole('button', { name: 'Undo last decision', exact: true });
  await expect(undo).toBeDisabled();

  await decision(page, 'Known').click();
  await decision(page, 'New').click();
  await expect(term(page, 3)).toBeVisible();

  await undo.click();
  await expect(term(page, 2)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New 0', exact: true })).toBeVisible();
  await undo.click();
  await expect(term(page, 1)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Known 0', exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();

  // Whatever was sent before, the last word on both Notes is that they are unsorted.
  await expect
    .poll(() => {
      const last = new Map(sent.flat().map((entry) => [entry.id, entry.choice]));
      return [last.get(id(1)), last.get(id(2))];
    })
    .toEqual(['unsorted', 'unsorted']);
});

test('decisions the server has not taken survive a reload and are sent once it answers', async ({
  page,
}) => {
  await open(page, 40);
  let answering = false;
  const delivered: Decision[] = [];
  await page.route(
    (url) => url.pathname === '/api/notes/triage',
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (!answering)
        return route.fulfill({ status: 503, json: { error: { code: 'internal_error' } } });
      const body = route.request().postDataJSON() as { decisions: Decision[] };
      delivered.push(...body.decisions);
      return route.fulfill({ json: { applied: body.decisions, skipped: [] } });
    },
  );

  await decision(page, 'Known').click();
  await decision(page, 'Known').click();
  await decision(page, 'Unsure').click();
  await expect(term(page, 4)).toBeVisible();
  await expect(page.getByText('Saved on this device. Sends by itself.')).toBeVisible();

  await page.reload();
  await expect(term(page, 4)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Known 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unsure 1', exact: true })).toBeVisible();

  answering = true;
  await decision(page, 'New').click();
  await expect
    .poll(() => new Map(delivered.map((entry) => [entry.id, entry.choice])))
    .toEqual(
      new Map([
        [id(1), 'known'],
        [id(2), 'known'],
        [id(3), 'unsure'],
        [id(4), 'new'],
      ]),
    );
  await expect(page.getByText('Saved on this device. Sends by itself.')).toBeHidden();
});

test('the list finds any Note, opens it in the sweep, and shows the decision changed', async ({
  page,
}) => {
  await open(page, 3000);
  await decision(page, 'Unsure').click();
  await page.getByRole('button', { name: 'All Notes in triage', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Decisions' })).toBeVisible();
  await expect(page.getByText('Notes: 3000', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Show' }).selectOption('unsure');
  await expect(page.getByText('Notes: 1', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Show' }).selectOption('all');
  await page.getByRole('searchbox', { name: 'Search triage' }).fill('wort 2500');
  await expect(page.getByText('Notes: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Wort 2500/ }).click();

  await expect(term(page, 2500)).toBeVisible();
  await decision(page, 'Known').click();
  // The sweep carries on from where the list put it.
  await expect(term(page, 2501)).toBeVisible();

  await page.getByRole('button', { name: 'All Notes in triage', exact: true }).click();
  await page.getByRole('combobox', { name: 'Show' }).selectOption('known');
  await expect(page.getByRole('button', { name: /^Wort 2500/ })).toContainText('Known');
  await page.getByRole('combobox', { name: 'Order' }).selectOption('alpha');
  await page.getByRole('button', { name: 'Back to cards', exact: true }).click();
  await expect(term(page, 2501)).toBeVisible();
});

test('the keyboard decides, reveals and takes back', async ({ page }) => {
  await open(page, 20);
  await page.keyboard.press('1');
  await expect(term(page, 2)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByText('word 2', { exact: true })).toBeVisible();
  await page.keyboard.press('3');
  await expect(term(page, 3)).toBeVisible();
  await expect(page.getByText('word 3', { exact: true })).toBeHidden();
  await page.keyboard.press('Backspace');
  await expect(term(page, 2)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New 0', exact: true })).toBeVisible();
});

test('a finished sweep says what happens next and offers one pass over Unsure', async ({
  page,
}) => {
  await open(page, 3);
  await decision(page, 'Known').click();
  await decision(page, 'Unsure').click();
  await decision(page, 'New').click();

  await expect(page.getByRole('heading', { name: 'All sorted' })).toBeVisible();
  await expect(page.getByText('Known 1 · Unsure 1 · New 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go through Unsure (1)', exact: true }).click();
  await expect(term(page, 2)).toBeVisible();
  await decision(page, 'Known').click();
  await expect(page.getByRole('heading', { name: 'No Unsure Notes left' })).toBeVisible();

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page).not.toHaveURL(/learning=triage/);
  await expect(page.getByRole('heading', { name: 'Triage' })).toBeVisible();
  await expect(page.getByText('3 / 3 sorted', { exact: true })).toBeVisible();
});

/** The Deck the sweep lives in, carrying the Note count the Deck screen already has. */
const wordDeck = (noteCount: number) => [
  {
    id: 'd5',
    kind: 'deck',
    name: 'Wortschatz',
    parentId: null,
    position: 0,
    path: [],
    settings: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
    due: 0,
    fresh: noteCount,
    noteCount,
    children: [],
  },
];

test('a Deck large enough for a sweep offers it without a request, and resumes it', async ({
  page,
}) => {
  const reads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/notes/triage')
      reads.push(request.url());
  });
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page, { notes: words(30), decks: wordDeck(30) });
  await page.goto('/notes?deckId=d5');

  await expect(page.getByRole('button', { name: /^Wort 1 word 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open triage', exact: true })).toBeVisible();
  // The entry comes from what the Deck screen already has; nothing is fetched for it.
  expect(reads).toEqual([]);
  await page.getByRole('button', { name: 'Open triage', exact: true }).click();
  await expect(term(page, 1)).toBeVisible();
  await decision(page, 'Known').click();
  await page.getByRole('button', { name: 'Close triage', exact: true }).click();

  await expect(page.getByText('1 / 30 sorted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue triage', exact: true }).click();
  await expect(term(page, 2)).toBeVisible();
});

test('a small Deck does not offer a sweep', async ({ page }) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page, { notes: words(5), decks: wordDeck(5) });
  await page.goto('/notes?deckId=d5');
  await expect(page.getByText('Wort 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Triage' })).toHaveCount(0);
});

test('offline, a downloaded collection is sorted on the device and sent on reconnecting', async ({
  page,
}) => {
  const account = {
    id: 'triage-offline',
    name: 'Offline',
    email: 'offline@example.test',
    image: null,
    locale: 'en',
    theme: 'system',
    timezone: 'Europe/Berlin',
    dayCutoffHour: 4,
    plan: 'free',
    settings: {},
    twoFactorEnabled: false,
    revision: 3,
  };
  const at = '2026-10-11T00:00:00.000Z';
  const deckId = id(900);
  const deck = {
    id: deckId,
    kind: 'deck',
    name: 'Offline list',
    parentId: null,
    position: 0,
    settings: null,
    createdAt: at,
    updatedAt: at,
    rev: 1,
  };
  const notes = triageNotes(30, deckId).map((row, index) => ({
    ...row,
    noteTypeId: id(901),
    // One set aside by the learner: not material to sort.
    status: index === 29 ? 'suspended' : 'active',
    rev: 2,
  }));
  const cards = notes.map((row, index) => ({
    id: id(1000 + index),
    noteId: row['id'],
    deckId,
    direction: 'recognition',
    slot: 0,
    // One already answered: Study owns it, triage leaves it out.
    state: index === 28 ? 'review' : 'new',
    stability: index === 28 ? 3 : null,
    difficulty: index === 28 ? 5 : null,
    due: at,
    lastReview: index === 28 ? at : null,
    placedDue: at,
    reps: index === 28 ? 1 : 0,
    lapses: 0,
    learningStep: 0,
    suspendedAt: null,
    unlockedAt: at,
    resetAt: null,
    updatedAt: at,
    rev: 3,
  }));
  const state = { offline: false, delivered: [] as Decision[] };
  await installFixtures(page);
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  const abort = (route: { abort: (code: string) => Promise<void> }) =>
    route.abort('internetdisconnected');
  await page.route('**/api/account', (route) =>
    state.offline ? abort(route) : route.fulfill({ json: account }),
  );
  await page.route('**/api/decks', (route) =>
    state.offline
      ? abort(route)
      : route.fulfill({
          json: { decks: [{ ...deck, path: [], children: [], noteCount: 30, due: 0, fresh: 28 }] },
        }),
  );
  await page.route('**/api/notes?*', (route) =>
    state.offline ? abort(route) : route.fulfill({ json: { items: notes } }),
  );
  await page.route('**/api/sync?*', (route) => {
    if (state.offline) return abort(route);
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    const rows = [
      { entity: 'decks', id: deckId, rev: 1, deleted: false, purged: false, row: deck },
      ...notes.map((row) => ({
        entity: 'notes',
        id: row['id'],
        rev: 2,
        deleted: false,
        purged: false,
        row,
      })),
      ...cards.map((row) => ({
        entity: 'cards',
        id: row.id,
        rev: 3,
        deleted: false,
        purged: false,
        row,
      })),
    ];
    return route.fulfill({
      json: { since, revision: 3, hasMore: false, changes: rows.filter((row) => row.rev > since) },
    });
  });
  await page.route(
    (url) => url.pathname === '/api/notes/triage',
    async (route) => {
      if (state.offline) return abort(route);
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { decisions: Decision[] };
        state.delivered.push(...body.decisions);
        return route.fulfill({ json: { applied: body.decisions, skipped: [] } });
      }
      return route.fulfill({
        json: { ...triageList(notes.slice(0, 28)), studied: 1, setAside: 1 },
      });
    },
  );

  await page.goto('/settings');
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  // A Note saved on this device that the server has not acknowledged yet. The
  // server's list cannot hold it, so the device's copy leaves it out as well.
  const unsent = id(950);
  await page.evaluate(
    async ({ accountId, deckId, noteId, operationId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(`neuron.collection:${accountId}`);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const values = { fields: { term: 'Unsent', translation: 'unsent' }, tags: [] };
      const at = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(
          {
            kind: 'note-create',
            accountId,
            entityId: noteId,
            operationId,
            sequence: 1,
            createdAt: at,
            updatedAt: at,
            payload: { accountId, operationId, noteId, deckId, noteType: 'vocab', ...values },
            working: values,
            started: false,
            state: 'pending',
          },
          `note-create:${noteId}`,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { accountId: account.id, deckId, noteId: unsent, operationId: id(951) },
  );

  // The record is valid: the device's browse list holds the Note.
  await page.goto(`/notes?deckId=${deckId}`);
  await page.getByRole('searchbox', { name: 'Search' }).fill('Unsent');
  await expect(page.getByRole('button', { name: /^Unsent unsent/ })).toBeVisible();
  await page.goto(`/notes?deckId=${deckId}&learning=triage`);
  await expect(term(page, 1)).toBeVisible();
  // The device's copy follows the server's rules: the answered and the set aside Notes are out,
  // and so is the Note the server has not received.
  await expect(page.getByText('Left: 28', { exact: true })).toBeVisible();
  await decision(page, 'Known').click();
  await decision(page, 'New').click();
  await expect(term(page, 3)).toBeVisible();
  await expect(page.getByText('Saved on this device. Sends by itself.')).toBeVisible();
  expect(state.delivered).toEqual([]);

  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => state.delivered)
    .toEqual([
      { id: id(1), choice: 'known' },
      { id: id(2), choice: 'new' },
    ]);
  await expect(page.getByText('Saved on this device. Sends by itself.')).toBeHidden();
});
