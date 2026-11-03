import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures } from './fixtures';
import {
  installInteractionMetrics,
  readInteractionMetrics,
  startInteractionMetrics,
} from './interaction-metrics';

import type { PendingNoteCreate } from '../src/lib/note-creation';
import type { PendingNoteEdit } from '../src/lib/note-outbox';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const deckId = '01900000-0000-7000-8000-000000000402';
const otherDeckId = '01900000-0000-7000-8000-000000000403';
const date = '2026-10-31T00:00:00.000Z';
const account = {
  id: 'note-creator',
  name: 'Creator',
  email: 'creator@example.test',
  image: null,
  locale: 'en',
  theme: 'system',
  timezone: 'Europe/Minsk',
  dayCutoffHour: 4,
  plan: 'free',
  settings: {},
  twoFactorEnabled: false,
  revision: 2,
};
const deckRow = (id: string, name: string, position: number) => ({
  id,
  kind: 'deck',
  name,
  parentId: null,
  position,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
});
const existing = {
  id: '01900000-0000-7000-8000-000000000401',
  deckId,
  noteTypeId: '01900000-0000-7000-8000-000000000409',
  noteType: 'vocab',
  fields: { term: 'Baum', translation: 'tree' } as Record<string, unknown>,
  tags: [] as string[],
  source: null,
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: date,
  updatedAt: date,
  rev: 2,
};
const answered = {
  id: '01900000-0000-7000-8000-000000000404',
  noteId: existing.id,
  deckId,
  direction: 'recognition',
  slot: 0,
  state: 'review',
  stability: 3,
  difficulty: 5,
  due: date,
  lastReview: date,
  placedDue: date,
  reps: 4,
  lapses: 0,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: date,
  resetAt: null,
  updatedAt: date,
  rev: 2,
};

type Row = Record<string, unknown> & { id: string; rev: number };
type Server = Awaited<ReturnType<typeof fixture>>;

async function records(page: Page, accountId = account.id) {
  return page.evaluate(async (owner) => {
    const opened = indexedDB.open(`neuron.collection:${owner}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const tx = db.transaction(['meta', 'outbox']);
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [creations, edits, drafts] = await Promise.all([
        read(tx.objectStore('meta').getAll(IDBKeyRange.bound('note-create:', 'note-create:￿'))),
        read(tx.objectStore('outbox').getAll()),
        read(
          tx
            .objectStore('meta')
            .getAll(IDBKeyRange.bound('note-create-draft:', 'note-create-draft:￿')),
        ),
      ]);
      return {
        creations: creations as PendingNoteCreate[],
        edits: (edits as PendingNoteEdit[]).sort((a, b) => a.sequence - b.sequence),
        drafts: drafts as Array<Record<string, unknown>>,
      };
    } finally {
      db.close();
    }
  }, accountId);
}

async function fixture(page: Page) {
  await installFixtures(page);
  const state = {
    offline: false,
    expired: false,
    who: account.id,
    lostAck: false,
    hold: undefined as Promise<void> | undefined,
    revision: 2,
    decks: new Map<string, Row & { deleted?: boolean }>([
      [deckId, deckRow(deckId, 'Words', 0)],
      [otherDeckId, deckRow(otherDeckId, 'Spare words', 1)],
    ]),
    notes: new Map<string, Row>([[existing.id, { ...existing }]]),
    cards: [{ ...answered }] as Row[],
    receipts: new Map<string, Record<string, unknown>>(),
    creates: [] as Array<Record<string, unknown>>,
    edits: [] as Array<Record<string, unknown>>,
    onlineCreates: 0,
  };
  const live = () => state.who === account.id;
  const fail = (route: Parameters<Parameters<Page['route']>[1]>[0]) =>
    route.abort('internetdisconnected');
  await page.route('**/api/account', (route) =>
    state.offline
      ? fail(route)
      : state.expired
        ? route.fulfill({
            status: 401,
            json: { error: { code: 'not_authenticated', status: 401, correlationId: 'expired' } },
          })
        : route.fulfill({ json: { ...account, id: state.who } }),
  );
  await page.route('**/api/decks', (route) =>
    state.offline
      ? fail(route)
      : route.fulfill({
          json: {
            decks: live()
              ? [...state.decks.values()]
                  .filter((deck) => !deck.deleted)
                  .map((deck) => ({
                    ...deck,
                    path: [],
                    children: [],
                    noteCount: [...state.notes.values()].filter(
                      (note) => note['deckId'] === deck.id,
                    ).length,
                    due: 0,
                    fresh: 0,
                  }))
              : [],
          },
        }),
  );
  await page.route('**/api/notes?*', (route) => {
    if (state.offline) return fail(route);
    const wanted = new URL(route.request().url()).searchParams.get('deckId');
    return route.fulfill({
      json: {
        items: live()
          ? [...state.notes.values()].filter((note) => !wanted || note['deckId'] === wanted)
          : [],
      },
    });
  });
  await page.route('**/api/notes', (route) => {
    if (route.request().method() === 'POST') state.onlineCreates++;
    return route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
  });
  await page.route(/\/api\/notes\/[^/?]+$/, (route) => {
    if (state.offline) return fail(route);
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const note = live() ? state.notes.get(id) : undefined;
    return note
      ? route.fulfill({
          json: { note, cards: state.cards.filter((card) => card['noteId'] === id) },
        })
      : route.fulfill({
          status: 404,
          json: { error: { code: 'not_found', status: 404, correlationId: 'missing' } },
        });
  });
  await page.route('**/api/notes/offline-create', async (route) => {
    if (state.offline) return fail(route);
    const body = route.request().postDataJSON() as Record<string, unknown> & {
      operationId: string;
      noteId: string;
      deckId: string;
      fields: Record<string, unknown>;
      tags: string[];
    };
    state.creates.push(body);
    await state.hold;
    if (state.expired || body['accountId'] !== state.who)
      return route.fulfill({
        status: 401,
        json: { error: { code: 'not_authenticated', status: 401, correlationId: 'expired' } },
      });
    let receipt = state.receipts.get(body.operationId);
    if (!receipt) {
      const deck = state.decks.get(body.deckId);
      if (!deck || deck.deleted) {
        receipt = {
          operationId: body.operationId,
          noteId: body.noteId,
          status: 'conflict',
          reason: 'deck_unavailable',
          revision: 0,
        };
      } else {
        const rev = ++state.revision;
        state.notes.set(body.noteId, {
          ...existing,
          id: body.noteId,
          deckId: body.deckId,
          noteType: body['noteType'] as string,
          fields: body.fields,
          tags: [...new Set(body.tags)].sort(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          rev,
        });
        // The server makes the Cards; the device never invents them.
        state.cards.push({
          ...answered,
          id: `01900000-0000-7000-8000-${String(900000000000 + state.cards.length)}`,
          noteId: body.noteId,
          deckId: body.deckId,
          state: 'new',
          stability: null,
          difficulty: null,
          lastReview: null,
          placedDue: null,
          reps: 0,
          due: new Date().toISOString(),
          rev: ++state.revision,
        });
        receipt = {
          operationId: body.operationId,
          noteId: body.noteId,
          status: 'applied',
          revision: rev,
        };
      }
      state.receipts.set(body.operationId, receipt);
    }
    if (state.lostAck) {
      state.lostAck = false;
      return route.fulfill({
        status: 503,
        json: { error: { code: 'internal_error', status: 503, correlationId: 'lost-ack' } },
      });
    }
    return route.fulfill({ json: receipt });
  });
  await page.route(/\/api\/notes\/[^/]+\/offline-edit$/, (route) => {
    if (state.offline) return fail(route);
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const body = route.request().postDataJSON() as Record<string, unknown> & {
      operationId: string;
      baseRev: number;
    };
    state.edits.push(body);
    let receipt = state.receipts.get(body.operationId);
    if (!receipt) {
      const note = state.notes.get(id);
      const conflict = !note || note.rev !== body.baseRev;
      if (!conflict)
        state.notes.set(id, {
          ...note,
          fields: body['fields'] as Record<string, unknown>,
          tags: [...new Set(body['tags'] as string[])].sort(),
          rev: ++state.revision,
        });
      receipt = {
        operationId: body.operationId,
        status: conflict ? 'conflict' : 'applied',
        revision: state.notes.get(id)?.rev ?? 0,
        ...(conflict ? { reason: note ? 'changed_remotely' : 'deleted_remotely' } : {}),
      };
      state.receipts.set(body.operationId, receipt);
    }
    return route.fulfill({ json: receipt });
  });
  await page.route('**/api/sync?*', (route) => {
    if (state.offline) return fail(route);
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    const rows = live()
      ? [
          ...[...state.decks.values()].map((row) => ({
            entity: 'decks',
            id: row.id,
            rev: row.rev,
            deleted: !!row.deleted,
            purged: false,
            row: { ...row, deleted: undefined },
          })),
          ...[...state.notes.values()].map((row) => ({
            entity: 'notes',
            id: row.id,
            rev: row.rev,
            deleted: false,
            purged: false,
            row,
          })),
          ...state.cards.map((row) => ({
            entity: 'cards',
            id: row.id,
            rev: row.rev,
            deleted: false,
            purged: false,
            row,
          })),
        ]
      : [];
    return route.fulfill({
      json: {
        since,
        revision: Math.max(since, live() ? state.revision : 0),
        hasMore: false,
        changes: rows.filter((row) => row.rev > since),
      },
    });
  });
  await page.goto('/settings');
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  return state;
}

async function disconnect(page: Page, state: Server) {
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}
async function reconnect(page: Page, state: Server) {
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
async function createOffline(page: Page, state: Server, term = 'Haus', translation = 'house') {
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(page.getByRole('button', { name: /Baum/ })).toBeVisible();
  await disconnect(page, state);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill(term);
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill(translation);
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('status').filter({ hasText: 'Saved on device' })).toBeVisible();
  const [created] = (await records(page)).creations;
  expect(created).toMatchObject({ state: 'pending', started: false });
  return created!;
}

test('Tags & Sources includes a device-only creation once and labels its synchronization state', async ({
  page,
}) => {
  const state = await fixture(page);
  const created = await createOffline(page, state);
  const unfinished = 'unfinished tag '.repeat(10);
  await page
    .getByRole('textbox', { name: 'Tags', exact: true })
    .fill(`new category, ${unfinished}`);
  await expect
    .poll(async () => (await records(page)).creations[0]?.working.tags)
    .toEqual(['new category', unfinished.trim()]);
  await page.goto('/library/categories');
  await expect(page.getByText(/including saved local changes/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'new category Notes: 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: `${unfinished.trim()} Notes: 1`, exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    unfinished.trim(),
  );
  const row = page.getByRole('button', { name: /Haus house.*Saved on device/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/notes/${created.entityId}$`));
  expect(state.creates).toEqual([]);
  await page.getByRole('button', { name: 'Find Notes', exact: true }).click();
  await reconnect(page, state);
  await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Tag or topic', exact: true })).toHaveValue(
    unfinished.trim(),
  );
  await expect(row).toBeVisible();
  expect(state.creates).toEqual([]);
});

test('a Note saved offline keeps its identity, is listed at once and gets server Cards on reconnect', async ({
  page,
}) => {
  const state = await fixture(page);
  const created = await createOffline(page, state);
  expect(page.url()).toMatch(new RegExp(`/notes/${created.entityId}$`));
  expect(created.payload).toMatchObject({
    noteId: created.entityId,
    deckId,
    noteType: 'vocab',
    fields: { term: 'Haus', translation: 'house' },
  });
  await expect(page.getByText('Cards are made when it syncs', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as known', exact: true })).toBeDisabled();
  expect(state.creates).toEqual([]);

  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.goto(`/notes?deckId=${deckId}`);
  const row = page.getByRole('button', { name: /Haus/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Saved on device', { exact: true })).toBeVisible();

  // An ordinary restart, still without a connection.
  await page.reload();
  await expect(page.getByRole('button', { name: /Haus/ })).toBeVisible();
  await page.getByRole('button', { name: /Haus/ }).click();
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('Haus');

  await reconnect(page, state);
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('synchronized');
  expect(state.creates).toHaveLength(1);
  expect(state.creates[0]).toEqual(created.payload);
  expect(state.onlineCreates).toBe(0);
  expect([...state.notes.keys()]).toEqual([existing.id, created.entityId]);
  // The existing schedule is untouched; the new Note has exactly the server's Card.
  expect(state.cards.find((card) => card.id === answered.id)).toEqual(answered);
  await expect(page.getByText('Cards are made when it syncs', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as known', exact: true })).toBeEnabled();
  await expect(page.getByText(/ready now/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('Haus');
});

test('edits before delivery coalesce; edits during a lost acknowledgement follow as one edit', async ({
  page,
}) => {
  await installInteractionMetrics(page);
  const state = await fixture(page);
  const created = await createOffline(page, state);
  const translation = page.getByRole('textbox', { name: 'Translation', exact: true });
  await translation.click();
  await translation.press('End');
  await startInteractionMetrics(page);
  await translation.pressSequentially(', home', { delay: 25 });
  await expect
    .poll(async () => (await records(page)).creations[0]?.payload.fields['translation'])
    .toBe('house, home');
  const metrics = await readInteractionMetrics(page);
  expect(metrics.scans['notes'] ?? 0).toBe(0);
  expect(metrics.scans['cards'] ?? 0).toBe(0);
  const unsent = (await records(page)).creations[0]!;
  expect(unsent.operationId).toBe(created.operationId);
  expect((await records(page)).edits).toEqual([]);

  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.lostAck = true;
  await reconnect(page, state);
  await expect.poll(() => state.creates.length).toBe(1);
  await translation.fill('house, home, building');
  await expect
    .poll(async () => (await records(page)).creations[0]?.working.fields['translation'])
    .toBe('house, home, building');
  expect((await records(page)).creations[0]!.payload).toEqual(unsent.payload);
  release();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('region', { name: 'Offline & sync' })
    .getByRole('button', { name: /^(Send now|Try again)$/ })
    .first()
    .click();
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('synchronized');
  await expect.poll(async () => (await records(page)).edits[0]?.state).toBe('synchronized');
  // The lost answer was retried with the identical command and wrote one Note.
  expect(state.creates.length).toBeGreaterThanOrEqual(2);
  for (const delivery of state.creates) expect(delivery).toEqual(unsent.payload);
  expect([...state.notes.keys()].filter((id) => id === created.entityId)).toHaveLength(1);
  expect(state.cards.filter((card) => card['noteId'] === created.entityId)).toHaveLength(1);
  const [edit] = (await records(page)).edits;
  const acknowledged = (await records(page)).creations[0]!.outcome!.revision;
  expect(edit!.payload.baseRev).toBe(acknowledged);
  expect(state.notes.get(created.entityId)!['fields']).toEqual({
    term: 'Haus',
    translation: 'house, home, building',
  });
});

test('a deleted destination keeps the Note; only the learner chooses where it goes', async ({
  page,
}) => {
  const state = await fixture(page);
  const created = await createOffline(page, state);
  state.decks.set(deckId, { ...state.decks.get(deckId)!, deleted: true, rev: ++state.revision });
  await reconnect(page, state);
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('conflict');
  expect(state.notes.has(created.entityId)).toBe(false);
  await expect(page.getByRole('status').filter({ hasText: 'Needs review' })).toBeVisible();

  await page.goto('/settings');
  const recovery = page.getByRole('region', { name: 'New Notes saved on this device' });
  await expect(recovery.getByText('Haus', { exact: true })).toBeVisible();
  await expect(recovery.getByText(/Its Deck was deleted/)).toBeVisible();
  expect(state.creates).toHaveLength(1);
  await recovery.getByRole('button', { name: 'Add it to this Deck', exact: true }).click();
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('synchronized');
  const settled = (await records(page)).creations[0]!;
  expect(settled.entityId).toBe(created.entityId);
  expect(settled.operationId).not.toBe(created.operationId);
  expect(settled.previous?.[0]).toMatchObject({ operationId: created.operationId, deckId });
  expect(state.notes.get(created.entityId)!['deckId']).toBe(otherDeckId);
  await expect(recovery).toHaveCount(0);
});

test('a refused Note can be archived without leaving the device or reaching a Deck', async ({
  page,
}) => {
  const state = await fixture(page);
  const created = await createOffline(page, state);
  await page.route('**/api/notes/offline-create', (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: 'invalid_note_fields', status: 400, correlationId: 'refused' } },
    }),
  );
  await reconnect(page, state);
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('rejected');
  await page.goto('/settings');
  const recovery = page.getByRole('region', { name: 'New Notes saved on this device' });
  await expect(recovery.getByText(/refused this new Note/)).toBeVisible();
  await recovery.getByRole('button', { name: 'Stop syncing and archive', exact: true }).click();
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('resolved');
  expect((await records(page)).creations[0]!.working).toEqual(created.working);
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(page.getByRole('button', { name: /Baum/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Haus/ })).toHaveCount(0);
});

test('session expiry and another account never deliver; the matching account does, once', async ({
  page,
}) => {
  const state = await fixture(page);
  await createOffline(page, state);
  state.expired = true;
  await reconnect(page, state);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.creates).toEqual([]);
  state.expired = false;
  state.who = 'another-note-creator';
  await page.evaluate(() => localStorage.removeItem('neuron.offline.signedOut'));
  await page.goto(`/settings`);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'New Notes saved on this device' })).toHaveCount(0);
  expect((await records(page)).creations[0]?.state).toBe('pending');
  expect((await records(page, 'another-note-creator')).creations).toEqual([]);
  expect(state.creates).toEqual([]);
  state.who = account.id;
  await page.goto('/settings');
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('synchronized');
  expect(state.creates).toHaveLength(1);
});

test('a storage failure keeps the form and saves nothing until a retry commits', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(page.getByRole('button', { name: /Baum/ })).toBeVisible();
  await disconnect(page, state);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Fenster');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('window');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'meta' && String(args[1]).startsWith('note-create:')) {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Injected quota', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /could not be saved/ })).toBeVisible();
  await expect(page).toHaveURL(/\/notes\/new/);
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('Fenster');
  expect((await records(page)).creations).toEqual([]);
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  expect((await records(page)).creations).toHaveLength(1);
  expect(state.creates).toEqual([]);
});

test('the unsaved form survives a restart with its identity and leaves when discarded', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(page.getByRole('button', { name: /Baum/ })).toBeVisible();
  await disconnect(page, state);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Tisch');
  await expect
    .poll(async () => (await records(page)).drafts[0]?.['fields'])
    .toEqual({
      term: 'Tisch',
    });
  const noteId = (await records(page)).drafts[0]!['noteId'];
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('Tisch');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('table');
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`));
  expect((await records(page)).drafts).toEqual([]);

  await page.goto(`/notes/new?deckId=${deckId}`);
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Stuhl');
  await expect.poll(async () => (await records(page)).drafts).toHaveLength(1);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect.poll(async () => (await records(page)).drafts).toEqual([]);
  await page.goto(`/notes/new?deckId=${deckId}`);
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('');
});

test('online with a complete download a new Note is saved first and delivered at once', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/notes/new?deckId=${deckId}`);
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Lampe');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('lamp');
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect.poll(async () => (await records(page)).creations[0]?.state).toBe('synchronized');
  await expect(page.getByRole('button', { name: 'Mark as known', exact: true })).toBeEnabled();
  expect(state.creates).toHaveLength(1);
  expect(state.onlineCreates).toBe(0);
  await page.goto(`/notes?deckId=${deckId}`);
  const row = page.getByRole('button', { name: /Lampe/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Saved on device', { exact: true })).toHaveCount(0);
});

test('a Deck not on the device cannot take an offline Note, and says why', async ({ page }) => {
  const state = await fixture(page);
  const unknown = '01900000-0000-7000-8000-000000000499';
  await disconnect(page, state);
  await page.goto(`/notes/new?deckId=${unknown}`);
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Weit');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('far');
  const save = page.getByRole('button', { name: 'Save the note', exact: true });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByRole('alert').filter({ hasText: /not on this device/ })).toBeVisible();
  }
  expect((await records(page)).creations).toEqual([]);
});
