const locale = 'en';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { vocabularyFixture } from '../../../scripts/import-fixture';

import {
  useFixtures as installBaseFixtures,
  usePreferences as installPreferences,
} from './fixtures';

import type { ImportDraft } from '../src/features/import/import-drafts';
import type { Page } from '@playwright/test';

const IMPORT_DECK_ID = '01900000-0000-7000-8000-000000000011';
const IMPORT_DECK_NAME = 'Verben mit Dativ';
const duplicateIds = {
  unique: '01900000-0000-7000-8000-000000000021',
  wrong: '01900000-0000-7000-8000-000000000022',
  right: '01900000-0000-7000-8000-000000000023',
  a: '01900000-0000-7000-8000-000000000024',
  b: '01900000-0000-7000-8000-000000000025',
  basic: '01900000-0000-7000-8000-000000000026',
  destination: '01900000-0000-7000-8000-000000000027',
  present: '01900000-0000-7000-8000-000000000028',
};

async function installFixtures(page: Page) {
  await installBaseFixtures(page);
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      json: { decks: [{ ...offlineTree.decks[0], id: IMPORT_DECK_ID, name: IMPORT_DECK_NAME }] },
    }),
  );
}

for (const storedLocale of ['en', 'ru'] as const) {
  test(`duplicate defaults, exceptions and undo boundary in ${storedLocale}`, async ({ page }) => {
    await installPreferences(page, {
      theme: locale === 'en' ? 'dark' : 'light',
      locale: storedLocale,
      glass: 'off',
    });
    await installFixtures(page);
    const matches = [
      { term: 'unique', noteId: duplicateIds.unique, noteType: 'vocab' },
      { term: 'mixed', noteId: duplicateIds.wrong, noteType: 'basic' },
      { term: 'mixed', noteId: duplicateIds.right, noteType: 'vocab' },
      { term: 'ambiguous', noteId: duplicateIds.a, noteType: 'vocab' },
      { term: 'ambiguous', noteId: duplicateIds.b, noteType: 'vocab' },
      { term: 'incompatible', noteId: duplicateIds.basic, noteType: 'basic' },
    ].map((match) => ({ ...match, deckId: IMPORT_DECK_ID, written: match.term }));
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    await page.route('**/api/notes/duplicates', (route) => route.fulfill({ json: { matches } }));
    await page.route('**/api/imports**', async (route) => {
      if (route.request().method() === 'POST')
        writes.push({
          path: new URL(route.request().url()).pathname,
          body: route.request().postDataJSON(),
        });
      await route.fulfill({ json: { notes: 2, cards: 2, reviewedCards: 0 } });
    });
    await page.route('**/api/notes/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      await route.fulfill({ json: {} });
    });
    await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
    await page.locator('textarea').fill(
      JSON.stringify({
        noteType: 'vocab',
        notes: ['unique', 'mixed', 'ambiguous', 'incompatible', 'fresh'].map((term) => ({
          term,
          translation: 'meaning',
        })),
      }),
    );
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Preview import' : 'Проверить перед импортом',
      })
      .click();
    const defaultChoice = page.getByLabel(
      locale === 'en' ? 'Default for duplicates' : 'По умолчанию для совпадений',
      { exact: true },
    );
    await defaultChoice.selectOption('merge');
    const row = (term: string) =>
      page.locator('[data-import-row]').filter({ has: page.getByText(term, { exact: true }) });
    await expect(row('ambiguous')).toContainText(
      locale === 'en' ? 'Several matching notes' : 'Найдено несколько',
    );
    await row('ambiguous').locator('select').focus();
    await expect(row('ambiguous').locator('select')).toBeFocused();
    expect((await row('ambiguous').locator('select').boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
    await page.screenshot({
      path: test.info().outputPath(`import-${storedLocale}.png`),
      fullPage: true,
    });
    await expect(row('incompatible')).toContainText(
      locale === 'en' ? 'another note type' : 'другой тип',
    );
    await expect(row('ambiguous').locator('option[value=merge]')).toBeDisabled();
    await expect(row('mixed').locator('option[value=merge]')).toBeEnabled();
    await row('unique').locator('select').selectOption('skip');
    await row('ambiguous').locator('select').selectOption('create');
    await expect(row('ambiguous')).toContainText(
      locale === 'en' ? 'overrides the import default' : 'выбрано отдельное',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page
      .getByRole('button', { name: locale === 'en' ? /^Import 3/ : /^Импортировать записей: 3/ })
      .click();
    await expect(
      page.getByText(locale === 'en' ? 'Import complete' : 'Импорт завершён', { exact: true }),
    ).toBeVisible();
    const patches = writes.filter((write) => write.path.startsWith('/api/notes/'));
    expect(patches).toEqual([
      {
        path: `/api/notes/${duplicateIds.right}`,
        body: {
          merge: true,
          noteType: 'vocab',
          fields: { term: 'mixed', translation: 'meaning' },
          importMerge: {
            attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            deckId: IMPORT_DECK_ID,
          },
        },
      },
    ]);
    const chunk = writes.find((write) => write.path.endsWith('/notes'))!.body['notes'] as {
      fields: { term: string };
    }[];
    expect(chunk.map((note) => note.fields.term)).toEqual(['ambiguous', 'fresh']);
    await expect(
      page.getByText(
        locale === 'en'
          ? /Additions to existing notes stay/
          : /Дополнения к существующим записям останутся/,
      ),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Take this import back' : 'Откатить этот импорт',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      locale === 'en' ? 'Review history is kept' : 'История ответов сохранится',
    );
  });
}

test('checks duplicates in the selected destination deck', async ({ page }) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  let checked: Record<string, unknown> | undefined;
  await page.route('**/api/notes/duplicates', async (route) => {
    checked = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { matches: [] } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [{ term: 'elsewhere', translation: 'allowed' }],
    }),
  );
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText('elsewhere', { exact: true })).toBeVisible();
  expect(checked).toEqual({ deckId: IMPORT_DECK_ID, terms: ['elsewhere'] });
  await expect(page.getByRole('button', { name: /^Import 1/ })).toBeEnabled();
});

test('final import creates an other-deck term in the selected destination', async ({ page }) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/notes/duplicates', (route) => route.fulfill({ json: { matches: [] } }));
  await page.route('**/api/imports**', async (route) => {
    if (route.request().method() === 'POST') {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
    }
    await route.fulfill({ json: { notes: 1, cards: 1 } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [{ term: 'elsewhere only', translation: 'create here' }],
    }),
  );
  await page.getByRole('button', { name: 'Preview import' }).click();
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  expect(writes.map((write) => write.path)).toEqual([
    '/api/imports',
    expect.stringMatching(/\/notes$/),
  ]);
  const chunk = writes[1]?.body['notes'] as { fields: { term: string } }[];
  expect(chunk.map((note) => note.fields.term)).toEqual(['elsewhere only']);
});

test('final import merges an exact destination duplicate without creating an empty batch', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/notes/duplicates', (route) =>
    route.fulfill({
      json: {
        matches: [
          {
            term: 'destination only',
            noteId: duplicateIds.destination,
            noteType: 'vocab',
            deckId: IMPORT_DECK_ID,
            written: 'Destination only',
          },
        ],
      },
    }),
  );
  await page.route(`**/api/notes/${duplicateIds.destination}`, async (route) => {
    writes.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await route.fulfill({ json: {} });
  });
  await page.route('**/api/imports**', async (route) => {
    writes.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await route.fulfill({ json: { notes: 0, cards: 0 } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [{ term: 'destination only', translation: 'fill this if blank' }],
    }),
  );
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText(`Already in ${IMPORT_DECK_NAME}`, { exact: true })).toBeVisible();
  await page.getByLabel('Default for duplicates', { exact: true }).selectOption('merge');
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  expect(writes).toEqual([
    {
      path: `/api/notes/${duplicateIds.destination}`,
      body: {
        merge: true,
        noteType: 'vocab',
        fields: { term: 'destination only', translation: 'fill this if blank' },
        importMerge: {
          attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          deckId: IMPORT_DECK_ID,
        },
      },
    },
  ]);
  await expect(page.getByRole('button', { name: 'Take this import back' })).toHaveCount(0);
});

test('all skipped rows stay a clean no-op and do not start an import batch', async ({ page }) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  let importWrites = 0;
  await page.route('**/api/notes/duplicates', (route) =>
    route.fulfill({
      json: {
        matches: [
          {
            term: 'already present',
            noteId: duplicateIds.present,
            noteType: 'vocab',
            deckId: IMPORT_DECK_ID,
            written: 'Already present',
          },
        ],
      },
    }),
  );
  await page.route('**/api/imports**', async (route) => {
    importWrites += 1;
    await route.fulfill({ json: {} });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [{ term: 'already present', translation: 'keep existing' }],
    }),
  );
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText(`Already in ${IMPORT_DECK_NAME}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Nothing here to import yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import 0/ })).toBeDisabled();
  expect(importWrites).toBe(0);
});

test('lost chunk response resumes with the original IDs and does not duplicate rows', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  const attempts: string[][] = [];
  const accepted = new Set<string>();
  await page.route('**/api/imports**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/notes')) {
      const rows = route.request().postDataJSON().notes as { id: string }[];
      attempts.push(rows.map((row) => row.id));
      rows.forEach((row) => accepted.add(row.id));
      if (attempts.length === 1) return route.abort('failed');
    }
    await route.fulfill({ json: { notes: accepted.size, cards: accepted.size } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [
        { term: 'one', translation: 'first' },
        { term: 'two', translation: 'second' },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Preview import' }).click();
  await page.getByRole('button', { name: /^Import 2/ }).click();
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(accepted.size).toBe(2);
});

test('completed import invalidates the cached destination list before opening its deck', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);

  let completed = false;
  let listReads = 0;
  const existing = {
    id: 'existing',
    deckId: IMPORT_DECK_ID,
    noteType: 'vocab',
    fields: { term: 'already here', translation: 'present' },
    tags: [],
    source: null,
    rank: null,
    status: 'active',
    importBatchId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rev: 1,
    cardStates: { new: 1, learning: 0, review: 0, relearning: 0 },
  };
  const imported = {
    ...existing,
    id: 'imported',
    fields: { term: 'newly imported', translation: 'now visible' },
    importBatchId: 'batch_1',
  };

  await page.route('**/api/notes?**', async (route) => {
    listReads += 1;
    await route.fulfill({ json: { items: completed ? [existing, imported] : [existing] } });
  });
  await page.route('**/api/imports**', async (route) => {
    if (route.request().method() === 'GET') completed = true;
    await route.fulfill({ json: { notes: 1, cards: 1 } });
  });

  await page.goto(`/notes?deckId=${IMPORT_DECK_ID}`);
  await expect(page.getByText('already here', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [{ term: 'newly imported', translation: 'now visible' }],
    }),
  );
  await page.getByRole('button', { name: 'Preview import' }).click();
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open the deck' }).click();

  await expect(page.getByText('already here', { exact: true })).toBeVisible();
  await expect(page.getByText('newly imported', { exact: true })).toBeVisible();
  expect(listReads).toBeGreaterThanOrEqual(2);
});

const offlineDeckId = '01900000-0000-7000-8000-000000000011';
const offlineNoteId = '01900000-0000-7000-8000-000000000012';
const timestamp = '2026-10-10T00:00:00.000Z';
const offlineDeck = {
  id: offlineDeckId,
  kind: 'deck',
  name: 'Offline import deck',
  parentId: null,
  position: 0,
  settings: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  rev: 1,
};
const offlineNote = {
  id: offlineNoteId,
  deckId: offlineDeckId,
  noteType: 'vocab',
  fields: { term: 'Haus', translation: 'house' },
  tags: [],
  source: null,
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  rev: 1,
};
const draftAccount = {
  id: 'user_1',
  name: 'Learner',
  email: 'learner@example.test',
  image: null,
  locale: 'en',
  theme: 'system',
  timezone: 'Europe/Minsk',
  dayCutoffHour: 4,
  plan: 'free',
  settings: {},
  twoFactorEnabled: false,
  revision: 1,
};
const offlineTree = {
  decks: [{ ...offlineDeck, path: [], children: [], due: 0, fresh: 0, noteCount: 1 }],
};
const offlinePage = {
  since: 0,
  revision: 1,
  hasMore: false,
  changes: [
    { entity: 'decks', id: offlineDeckId, rev: 1, deleted: false, purged: false, row: offlineDeck },
    { entity: 'notes', id: offlineNoteId, rev: 1, deleted: false, purged: false, row: offlineNote },
  ],
};

async function storedDrafts(page: Page, accountId = 'user_1') {
  return page.evaluate(async (accountId) => {
    const opened = indexedDB.open(`neuron.collection:${accountId}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const store = db.transaction('meta').objectStore('meta');
      const read = store.getAll(IDBKeyRange.bound('import-draft:', 'import-draft:\uffff'));
      const headers = await new Promise<(Omit<ImportDraft, 'format'> & { format: number })[]>(
        (resolve, reject) => {
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
        },
      );
      return await Promise.all(
        headers.map(async (head) => {
          if (head.format === 1) return head;
          const get = <T>(key: string) =>
            new Promise<T>((resolve, reject) => {
              const request = store.get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          const [preparation, attempt] = await Promise.all([
            get<ImportDraft['preparation']>(`import-preparation:${head.id}`),
            head.delivery
              ? get<NonNullable<ImportDraft['delivery']>['attempt']>(`import-attempt:${head.id}`)
              : undefined,
          ]);
          return {
            ...head,
            format: 1 as const,
            preparation,
            ...(head.delivery ? { delivery: { ...head.delivery, attempt: attempt! } } : {}),
          };
        }),
      );
    } finally {
      db.close();
    }
  }, accountId);
}

test('large Import performance and interrupted checkpoint measurements', async ({
  page,
  browserName,
}) => {
  test.skip(process.env['IMPORT_BENCHMARK'] !== 'true' || browserName !== 'chromium');
  test.setTimeout(180_000);
  await installPreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
  await installFixtures(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    const spans: { startTime: number; duration: number }[] = [];
    new PerformanceObserver((list) =>
      spans.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))),
    ).observe({ type: 'longtask', buffered: true });
    Object.assign(window, { importLongTasks: spans });
    const writes: string[] = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'meta' && /^import-(preparation|attempt):/.test(String(args[1])))
        writes.push(String(args[1]));
      return put.apply(this, args);
    };
    Object.assign(window, { importPayloadWrites: writes });
  });
  const rows = vocabularyFixture(5000);
  // Bad rows remain visible and excluded; existing terms are skipped.
  const raw = JSON.stringify({
    noteType: 'vocab',
    notes: rows.map((row, i) => (i >= 4995 ? { ...row, translation: '' } : row)),
  });
  let lookups = 0;
  await page.route('**/api/notes/duplicates', async (route) => {
    lookups++;
    const terms = route.request().postDataJSON().terms as string[];
    await new Promise((resolve) => setTimeout(resolve, 30));
    await route.fulfill({
      json: {
        matches: terms
          .filter((term) => Number(term.split(' ')[1]) < 500)
          .map((term) => ({
            term: term.toLowerCase(),
            written: term,
            noteType: 'vocab',
            deckId: IMPORT_DECK_ID,
            noteId: `01900000-0000-7000-8000-${Number(term.split(' ')[1]).toString().padStart(12, '0')}`,
          })),
      },
    });
  });
  const accepted = new Set<string>();
  const chunks: string[][] = [];
  let loseResponse = true;
  await page.route('**/api/imports**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/notes')) {
      const notes = route.request().postDataJSON().notes as { id: string }[];
      chunks.push(notes.map((note) => note.id));
      notes.forEach((note) => accepted.add(note.id));
      if (loseResponse) {
        loseResponse = false;
        return route.abort('failed');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    await route.fulfill({ json: { notes: accepted.size, cards: accepted.size } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(raw);
  const start = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Import 4495/ })).toBeEnabled();
  const previewMs = (await page.evaluate(() => performance.now())) - start;
  await expect(page.locator('[data-import-row]')).toHaveCount(200);
  const previewHeap = await session.send('Runtime.getHeapUsage');
  const applyingAt = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: /^Import 4495/ }).click();
  await expect(page.getByRole('button', { name: 'Carry on from where it stopped' })).toBeVisible();
  const freezeAndFailedChunkMs = (await page.evaluate(() => performance.now())) - applyingAt;
  const checkpoint = (await storedDrafts(page))[0]!;
  expect(checkpoint.delivery?.done).toBe(0);
  const reopeningAt = Date.now();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Carry on from where it stopped' })).toBeVisible();
  const reopenMs = Date.now() - reopeningAt;
  const resumingAt = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  // This is a measurement, not the ordinary interaction latency budget.
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible({ timeout: 30_000 });
  const resumedAt = await page.evaluate(() => performance.now());
  const resumeMs = resumedAt - resumingAt;
  const completed = (await storedDrafts(page))[0]!;
  const payloadWrites = await page.evaluate(
    () => (window as unknown as { importPayloadWrites: string[] }).importPayloadWrites.length,
  );
  expect(payloadWrites).toBe(0);
  const checkpointHeaderBytes = await page.evaluate(async (id) => {
    const open = indexedDB.open('neuron.collection:user_1');
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    try {
      const get = db.transaction('meta').objectStore('meta').get(`import-draft:${id}`);
      return await new Promise<number>((resolve) => {
        get.onsuccess = () => resolve(JSON.stringify(get.result).length);
      });
    } finally {
      db.close();
    }
  }, completed.id);
  expect(accepted.size).toBe(4495);
  expect(chunks[1]).toEqual(chunks[0]);
  expect(completed.delivery?.attempt).toEqual(checkpoint.delivery?.attempt);
  expect(completed.delivery).toMatchObject({ done: 9, summary: { notes: 4495, cards: 4495 } });
  const longTasks = await page.evaluate(
    ({ after, until }) =>
      (
        window as unknown as { importLongTasks: { startTime: number; duration: number }[] }
      ).importLongTasks
        .filter((entry) => entry.startTime >= after && entry.startTime < until)
        .map((entry) => Math.min(entry.duration, until - entry.startTime)),
    { after: resumingAt, until: resumedAt },
  );
  console.log(
    JSON.stringify({
      dataset: '5000 rich vocab, 500 existing, 5 invalid; 4495 additions',
      cpuThrottle: 4,
      responseDelayMs: 30,
      previewMs,
      freezeAndFailedChunkMs,
      reopenMs,
      resumeMs,
      lookupRequests: lookups,
      chunkRequests: chunks.length,
      previewHeapBytes: previewHeap.usedSize,
      longestResumeTaskMs: Math.max(0, ...longTasks),
      checkpointBytes: JSON.stringify(completed).length,
      checkpointHeaderBytes,
    }),
  );
});

test('failed acknowledgement persistence retains the frozen plan and stops before the next chunk', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  const accepted = new Set<string>();
  const attempts: string[][] = [];
  await page.route('**/api/notes/duplicates', (route) => route.fulfill({ json: { matches: [] } }));
  await page.route('**/api/imports**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/notes')) {
      const rows = route.request().postDataJSON().notes as { id: string }[];
      attempts.push(rows.map((row) => row.id));
      rows.forEach((row) => accepted.add(row.id));
    }
    await route.fulfill({ json: { notes: accepted.size, cards: accepted.size } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page
    .locator('textarea')
    .fill(Array.from({ length: 1001 }, (_, i) => `term ${i}\tmeaning ${i}`).join('\n'));
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Import 1001/ })).toBeEnabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const value = args[0] as { delivery?: { done: number } };
      if (String(args[1]).startsWith('import-draft:') && value.delivery && value.delivery.done > 0)
        throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('button', { name: /^Import 1001/ }).click();
  await expect(page.getByRole('button', { name: 'Carry on from where it stopped' })).toBeVisible();
  expect(attempts).toHaveLength(1);
  const before = (await storedDrafts(page))[0]!;
  expect(before.delivery?.done).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(4);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(accepted.size).toBe(1001);
  expect((await storedDrafts(page))[0]!.delivery).toMatchObject({
    attempt: before.delivery!.attempt,
    done: 3,
    summary: { notes: 1001, cards: 1001 },
  });
});

test('merge-only delivery checkpoints confirmed groups and resumes the unconfirmed suffix', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  const terms = Array.from({ length: 41 }, (_, i) => `merge ${i}`);
  const ids = terms.map((_, i) => `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`);
  let checks = 0;
  await page.route('**/api/notes/duplicates', (route) => {
    checks++;
    return route.fulfill({
      json: {
        matches: terms.map((term, i) => ({
          term,
          written: term,
          noteId: ids[i],
          deckId: IMPORT_DECK_ID,
          noteType: 'vocab',
        })),
      },
    });
  });
  let fail = true;
  const patches: string[] = [];
  const attempts: unknown[] = [];
  const accepted = new Set<string>();
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    patches.push(id);
    attempts.push((route.request().postDataJSON() as { importMerge?: unknown }).importMerge);
    accepted.add(id);
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (fail && id === ids[25]) {
      fail = false;
      return route.abort('failed');
    }
    await route.fulfill({ status: 204 });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill(terms.map((term) => `${term}\tmeaning`).join('\n'));
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByLabel('Default for duplicates', { exact: true }).selectOption('merge');
  await page.getByRole('button', { name: /^Import 41/ }).click();
  await expect(page.getByRole('button', { name: 'Carry on from where it stopped' })).toBeVisible();
  const frozen = (await storedDrafts(page))[0]!;
  expect(frozen.delivery).toMatchObject({ merged: 20, done: 0 });
  const checksBeforeResume = checks;
  const at = patches.length;
  await page.reload();
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Existing notes processed: 41.', { exact: true })).toBeVisible();
  expect(patches.slice(at).every((id) => !ids.slice(0, 20).includes(id))).toBe(true);
  expect(accepted.size).toBe(41);
  expect(attempts).toEqual(
    Array(attempts.length).fill({
      attemptId: frozen.delivery!.attempt.batchId,
      deckId: IMPORT_DECK_ID,
    }),
  );
  expect(checks).toBe(checksBeforeResume);
  expect((await storedDrafts(page))[0]!.delivery).toMatchObject({
    attempt: frozen.delivery!.attempt,
    done: 0,
    merged: 41,
    summary: { notes: 0, cards: 0 },
  });
});

test('a mismatched server summary retains recovery and completion does not wait for cache warming', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  let complete = false;
  let summaryNotes = 0;
  let release!: () => void;
  const warmed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/notes/duplicates', (route) => route.fulfill({ json: { matches: [] } }));
  await page.route('**/api/imports**', (route) => {
    if (route.request().method() === 'GET') complete = summaryNotes === 1;
    return route.fulfill({ json: { notes: summaryNotes, cards: summaryNotes } });
  });
  await page.route('**/api/notes?*', async (route) => {
    if (complete) await warmed;
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill('one\tmeaning');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect(page.getByRole('alert')).toContainText(
    'The saved plan and the server result differ',
  );
  expect((await storedDrafts(page))[0]!.delivery?.summary).toBeUndefined();
  summaryNotes = 1;
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  try {
    await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
    expect((await storedDrafts(page))[0]!.delivery?.summary).toEqual({ notes: 1, cards: 1 });
  } finally {
    release();
  }
});

test('changing preparation during final duplicate validation cannot freeze the old source', async ({
  page,
}) => {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  let release!: () => void;
  const validated = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldChecks = 0;
  let writes = 0;
  await page.route('**/api/notes/duplicates', async (route) => {
    if (await page.evaluate(() => document.documentElement.dataset['importClicked'] === 'true')) {
      heldChecks++;
      await validated;
    }
    await route.fulfill({ json: { matches: [] } }).catch(() => undefined);
  });
  await page.route('**/api/imports**', (route) => {
    writes++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await page.locator('textarea').fill('old\tmeaning');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByRole('button', { name: /^Import 1/ }).evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        document.documentElement.dataset['importClicked'] = 'true';
      },
      { capture: true, once: true },
    );
  });
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect.poll(() => heldChecks).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('textarea').fill('replacement\tmeaning');
  release();
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  expect(writes).toBe(0);
  expect((await storedDrafts(page))[0]!.preparation.raw).toBe('replacement\tmeaning');
  expect((await storedDrafts(page))[0]!.delivery).toBeUndefined();
});

test('live PostgreSQL Import reopens a committed lost response and reconciles exact recovery records', async ({
  page,
  context,
}, info) => {
  test.skip(
    process.env['IMPORT_DATABASE_E2E'] !== 'true',
    'Requires the guarded throwaway database',
  );
  test.setTimeout(180_000);
  await import('../../api/src/db/testing/ws-proxy.js');
  const { serve } = await import('../../api/node_modules/@hono/node-server/dist/index.mjs');
  const { testDatabase, createUser, appClient, rawOwnerPool } =
    await import('../../api/src/db/testing/database.js');
  const { createRepositories } = await import('../../api/src/db/repositories/index.js');
  const { testServer } = await import('../../api/src/testing/server.js');
  const database = testDatabase();
  if (!database) throw new Error('Throwaway database required');
  const account = `import-browser-${info.project.name}-${Date.now()}`;
  await createUser(database, account);
  const client = appClient(database);
  const repo = createRepositories(client, account);
  const app = testServer(database, account, client);
  const target = await repo.decks.create({
    name: 'Live Import',
    settings: {
      ladder: [
        { direction: 'recognition', opensAtStability: 0 },
        { direction: 'recall', opensAtStability: 0 },
        { direction: 'listening', opensAtStability: 0 },
      ],
    },
  });
  const source = vocabularyFixture(5000);
  const seeded = await app.request('/api/imports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckId: target.id,
      source: 'Existing collection',
      notes: source
        .slice(0, 500)
        .map(({ tags, rank, ...fields }) => ({ noteType: 'vocab', fields, tags, rank })),
    }),
  });
  expect(seeded.status).toBe(201);
  const existing = (await repo.notes.list({ deckId: target.id, limit: 1 })).items[0]!;
  const oldCard = (await repo.cards.forNote(existing.id))[0]!;
  await repo.reviews.record({ cardId: oldCard.id, rating: 3, now: new Date() });
  const pool = rawOwnerPool(database);
  const reviews = (
    await pool.query('select * from reviews where card_id=$1 order by id', [oldCard.id])
  ).rows;
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const address = server.address() as { port: number };
  let lost = true;
  const chunks: string[][] = [];
  const pendingRoutes = new WeakMap<Page, Set<Promise<void>>>();
  const closeTab = async (tab: Page) => {
    const pending = new Set(pendingRoutes.get(tab));
    // Playwright's route-handled promise can remain unresolved after navigation
    // cancels a response. Stop interception, then drain our actual HTTP work,
    // checking errors ourselves before closing any database connections.
    await tab.unrouteAll({ behavior: 'ignoreErrors' });
    await tab.goto('about:blank');
    for (const work of pendingRoutes.get(tab) ?? []) pending.add(work);
    for (const outcome of await Promise.allSettled(pending)) {
      if (
        outcome.status === 'rejected' &&
        (!(outcome.reason instanceof Error) ||
          !/Route is already handled|Target page, context or browser has been closed/.test(
            outcome.reason.message,
          ))
      )
        throw outcome.reason;
    }
    await tab.close();
  };
  const routeApi = async (tab: Page) => {
    if (process.env['IMPORT_STORAGE_DIAGNOSTICS'] === 'true')
      await tab.addInitScript(() => {
        const transactions = new WeakMap<
          IDBTransaction,
          { at: number; first?: number; reads: number; writes: number; kind: string }
        >();
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          const tx = original.apply(this, args);
          const state: { at: number; first?: number; reads: number; writes: number; kind: string } =
            { at: performance.now(), reads: 0, writes: 0, kind: String(args[0]) };
          transactions.set(tx, state);
          const report = (result: string) => {
            const elapsed = performance.now() - state.at;
            if (elapsed > 500 || result === 'abort')
              console.log(
                'Import IndexedDB',
                JSON.stringify({ ...state, elapsed, result, mode: tx.mode, error: tx.error?.name }),
              );
          };
          tx.addEventListener('complete', () => report('complete'));
          tx.addEventListener('abort', () => report('abort'));
          return tx;
        };
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args) {
          const state = transactions.get(this.transaction);
          if (state) {
            state.reads++;
            if (String(args[0]).startsWith('import-')) state.kind = 'import';
          }
          const request = get.apply(this, args);
          request.addEventListener('success', () => {
            if (state && !state.first) state.first = performance.now() - state.at;
          });
          return request;
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          const state = transactions.get(this.transaction);
          if (state) state.writes++;
          return put.apply(this, args);
        };
      });
    tab.on('console', (message) => {
      if (
        message.text().startsWith('Import draft persistence failed') ||
        message.text().startsWith('Import IndexedDB')
      )
        console.log(message.text());
    });
    await installPreferences(tab, { locale: 'en', theme: 'dark', glass: 'off' });
    const pending = new Set<Promise<void>>();
    pendingRoutes.set(tab, pending);
    await tab.route(
      (url) => url.pathname.startsWith('/api/'),
      async (route) => {
        const work = (async () => {
          const url = new URL(route.request().url());
          const response = await route.fetch({
            url: `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
          });
          if (
            route.request().method() === 'POST' &&
            /^\/api\/imports\/[^/]+\/notes$/.test(url.pathname)
          ) {
            chunks.push(
              (route.request().postDataJSON().notes as { id: string }[]).map((row) => row.id),
            );
            expect(response.status()).toBe(200);
            if (lost) {
              lost = false;
              return route.abort('failed');
            }
          }
          await route.fulfill({ response });
        })();
        pending.add(work);
        try {
          await work;
        } finally {
          pending.delete(work);
        }
      },
    );
  };
  try {
    await routeApi(page);
    await page.goto(`/import?deckId=${target.id}`);
    await page.locator('textarea').fill(
      JSON.stringify({
        noteType: 'vocab',
        notes: source.map((row, i) => (i >= 4995 ? { ...row, translation: '' } : row)),
      }),
    );
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await page.getByRole('button', { name: /^Import 4495/ }).click();
    await expect(page.getByRole('button', { name: 'Carry on from where it stopped' })).toBeVisible({
      timeout: 30_000,
    });
    const interrupted = (await storedDrafts(page, account))[0]!;
    expect(interrupted, `Server chunks sent: ${chunks.length}`).toBeDefined();
    expect(interrupted.delivery?.done).toBe(0);
    const batch = interrupted.delivery!.attempt.batchId;
    expect(await repo.importBatches.contents(batch)).toMatchObject({ notes: 500, cards: 1500 });
    const initialCards = (
      await pool.query(
        'select c.* from cards c join notes n on n.id=c.note_id where n.import_batch_id=$1 order by c.id',
        [batch],
      )
    ).rows;
    await closeTab(page);
    const resumed = await context.newPage();
    await resumed.bringToFront();
    await routeApi(resumed);
    await resumed.goto(`/import?deckId=${target.id}`);
    await resumed.getByRole('button', { name: 'Carry on from where it stopped' }).click();
    await expect(resumed.getByText('Import complete', { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      resumed.getByText('Recovery checkpoint saved on this device.', { exact: true }),
    ).toBeVisible();
    const completed = (await storedDrafts(resumed, account))[0]!;
    expect(completed.delivery).toMatchObject({
      attempt: interrupted.delivery!.attempt,
      done: 9,
      merged: 0,
      summary: { notes: 4495, cards: 13485 },
    });
    expect(chunks).toHaveLength(10);
    expect(chunks[1]).toEqual(chunks[0]);
    const savedNotes = (
      await pool.query(
        'select id, rank, fields, tags from notes where import_batch_id=$1 order by rank',
        [batch],
      )
    ).rows;
    expect(savedNotes.map((note) => note.id)).toEqual(
      completed.delivery!.attempt.create.map((note) => note.id),
    );
    expect(savedNotes.map((note) => note.rank)).toEqual(
      source.slice(500, 4995).map((note) => note.rank),
    );
    expect(
      savedNotes.every((note) => note.fields.grammar.article === 'das' && note.tags.length === 2),
    ).toBe(true);
    const allCards = (
      await pool.query(
        'select c.* from cards c join notes n on n.id=c.note_id where n.import_batch_id=$1 order by c.id',
        [batch],
      )
    ).rows;
    expect(allCards).toHaveLength(13485);
    const oldIds = new Set(initialCards.map((card) => card.id));
    expect(allCards.filter((card) => oldIds.has(card.id))).toEqual(initialCards);
    expect(
      allCards.every(
        (card) =>
          card.deck_id === target.id &&
          card.slot === 0 &&
          ['recognition', 'recall', 'listening'].includes(card.direction),
      ),
    ).toBe(true);
    expect((await repo.importBatches.byId(batch))?.noteCount).toBe(4495);
    expect(
      (await pool.query('select * from reviews where card_id=$1 order by id', [oldCard.id])).rows,
    ).toEqual(reviews);
    await resumed.screenshot({ path: info.outputPath('live-import-completed.png') });
    // The interactive Import has already met its deadline. Continue through the
    // background pull of every revision on this large collection before Undo.
    test.setTimeout(840_000);
    const opening = initialCards[0] as { id: string; note_id: string };
    const downloaded = () =>
      resumed.evaluate(
        async ({ accountId, noteId, cardId }) => {
          function read<T>(request: IDBRequest<T>): Promise<T> {
            return new Promise((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          }
          const db = await read(indexedDB.open(`neuron.collection:${accountId}`));
          try {
            const tx = db.transaction(['meta', 'notes', 'cards']);
            const [sync, note, card] = await Promise.all([
              read(tx.objectStore('meta').get('sync')) as Promise<
                { cursor: number; complete: boolean } | undefined
              >,
              read(tx.objectStore('notes').get(noteId)) as Promise<
                { deleted: boolean } | undefined
              >,
              read(tx.objectStore('cards').get(cardId)) as Promise<
                { deleted: boolean } | undefined
              >,
            ]);
            return {
              cursor: sync?.cursor,
              complete: sync?.complete,
              noteDeleted: note?.deleted,
              cardDeleted: card?.deleted,
            };
          } finally {
            db.close();
          }
        },
        { accountId: account, noteId: opening.note_id, cardId: opening.id },
      );
    await expect.poll(downloaded, { timeout: 360_000 }).toEqual({
      cursor: await repo.sync.revision(),
      complete: true,
      noteDeleted: false,
      cardDeleted: false,
    });
    await resumed.getByRole('button', { name: 'Take this import back', exact: true }).click();
    await resumed
      .getByRole('dialog')
      .getByRole('button', { name: 'Take this import back', exact: true })
      .click();
    await expect(resumed.getByText('Import undone', { exact: true })).toBeVisible();
    await expect.poll(downloaded, { timeout: 360_000 }).toEqual({
      cursor: await repo.sync.revision(),
      complete: true,
      noteDeleted: true,
      cardDeleted: true,
    });
    expect(await repo.importBatches.contents(batch)).toMatchObject({ notes: 0, cards: 0 });
    expect(
      (await pool.query('select * from reviews where card_id=$1 order by id', [oldCard.id])).rows,
    ).toEqual(reviews);
  } finally {
    await Promise.all(context.pages().map(closeTab));
    server.close();
    await client.$client.end();
    await pool.end();
  }
});

async function installOfflineImportFixtures(page: Page, complete = true, preview = false) {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
  const control = { online: true, who: draftAccount };
  await page.route('**/api/account', (route) => route.fulfill({ json: control.who }));
  await page.route('**/api/decks', (route) => route.fulfill({ json: offlineTree }));
  await page.route('**/api/sync?*', (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    if (!complete && since > 0) return route.abort();
    return route.fulfill({
      json:
        since === 0
          ? { ...offlinePage, hasMore: !complete }
          : { since, revision: since, hasMore: false, changes: [] },
    });
  });
  await page.route('**/api/**', (route) =>
    control.online ? route.fallback() : route.abort('internetdisconnected'),
  );
  await page.goto(`/import?deckId=${offlineDeckId}`);
  await expect(
    page.getByRole('button', { name: preview ? 'Back' : 'Preview import', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open('neuron.collection:user_1');
        const db = await new Promise<IDBDatabase>((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        try {
          const read = db.transaction('meta').objectStore('meta').get('sync');
          return await new Promise<boolean>((resolve) => {
            read.onsuccess = () => resolve(read.result?.complete ?? false);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(complete);
  return {
    control,
    disconnect: async () => {
      control.online = false;
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    },
    reconnect: async () => {
      control.online = true;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    },
  };
}

for (const source of [
  { format: 'json', raw: '{"noteType":"vocab","notes":[{"term":"Haus","translation":"house"}]}' },
  { format: 'csv', raw: 'term,translation\nHaus,house' },
  { format: 'tsv', raw: 'Haus\thouse' },
  { format: 'text', raw: 'Haus — house' },
  { format: 'anki', raw: '#separator:tab\n#html:true\n<b>Haus</b>\thouse' },
])
  test(`offline ${source.format} source uses the normal validation and generated-card preview`, async ({
    page,
  }) => {
    const fixture = await installOfflineImportFixtures(page);
    await fixture.disconnect();
    await page.locator('textarea').fill(source.raw);
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await expect(page.getByText('Haus', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Preliminary matches from/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import \d/ })).toBeDisabled();
    await page
      .getByRole('button', { name: 'Cards from the first valid note', exact: true })
      .click();
    await expect(page.getByText('Cards this makes', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
    await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
    const drafts = await storedDrafts(page);
    expect(drafts[0]?.preparation.raw).toBe(source.raw);
    expect(drafts[0]?.delivery).toBeUndefined();
  });

test('offline preview trusts the completed durable page when loss interrupts its availability update', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const held = { waiting: false, release: () => {} };
    Object.assign(window, { importReadback: held });
    let sawComplete = false;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (
        this.name === 'meta' &&
        args[1] === 'sync' &&
        (args[0] as { complete?: boolean })?.complete
      )
        sawComplete = true;
      return put.apply(this, args);
    };
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key);
      if (
        this.name === 'meta' &&
        key === 'sync' &&
        sawComplete &&
        !held.waiting &&
        new Error().stack?.includes('/assets/')
      ) {
        request.addEventListener(
          'success',
          (event) => {
            if (!request.result?.complete) return;
            event.stopImmediatePropagation();
            held.waiting = true;
            held.release = () => {
              request.onsuccess?.call(request, event);
            };
          },
          { once: true },
        );
      }
      return request;
    };
  });
  const fixture = await installOfflineImportFixtures(page);
  type Readback = Window & { importReadback: { waiting: boolean; release: () => void } };
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Readback).importReadback.waiting))
    .toBe(true);
  try {
    await fixture.disconnect();
    await page.locator('textarea').fill('Haus — house');
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await expect(page.getByText(/^Preliminary matches from/)).toBeVisible();
    await expect(
      page.getByText('Will be created: 0 · Will be skipped: 1 · Will be merged: 0', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import 0/ })).toBeDisabled();
  } finally {
    await page.evaluate(() => (window as unknown as Readback).importReadback.release());
  }
});

test('offline saved mapping, choices and incomplete single-row input survive a reload', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page);
  await fixture.disconnect();
  await page.getByLabel('Word', { exact: true }).fill('Unadded term');
  await page.locator('textarea').fill('Haus\thouse');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByLabel('Default for duplicates', { exact: true }).selectOption('create');
  await page.getByLabel('Action for row 1', { exact: true }).selectOption('skip');
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Default for duplicates', { exact: true })).toHaveValue('create');
  await expect(page.getByLabel('Which column is which', { exact: true }).first()).toHaveValue(
    'term',
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Word', { exact: true })).toHaveValue('Unadded term');
  await expect(page.locator('textarea')).toHaveValue('Haus\thouse');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByLabel('Action for row 1', { exact: true })).toHaveValue('skip');
});

test('incomplete local collection provides preparation without claiming duplicate clearance', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page, false);
  await fixture.disconnect();
  await page.locator('textarea').fill('Haus — house');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByText(/^Collection duplicates have not been checked/)).toBeVisible();
  await expect(page.getByText(/^Preliminary matches from/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Import 1/ })).toBeDisabled();
});

test('invalid JSON, missing fields and all three note types remain preparable offline', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page);
  await fixture.disconnect();
  for (const [raw, expected] of [
    ['{"noteType":"basic","notes":[{"front":"Question","back":"Answer"}]}', 'Question'],
    ['{"noteType":"cloze","notes":[{"text":"I {{learn}}."}]}', 'I {{learn}}.'],
    ['{"noteType":"vocab","notes":[{"term":"Missing meaning"}]}', 'Missing meaning'],
    ['{incomplete', 'Cannot read row'],
  ]) {
    await page.locator('textarea').fill(raw!);
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await expect(page.getByText(expected!, { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
    await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
});

test('a 5,000-row offline file stays durable while the preview remains bounded', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page);
  await fixture.disconnect();
  const raw = Array.from({ length: 5000 }, (_, at) => `word ${at}\tmeaning ${at}`).join('\n');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'large.tsv',
    mimeType: 'text/tab-separated-values',
    buffer: Buffer.from(raw),
  });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByText('Rows read: 5000', { exact: true })).toBeVisible();
  await expect(page.locator('[data-import-row]')).toHaveCount(200);
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  expect((await storedDrafts(page))[0]?.preparation.raw).toBe(raw);
});

test('reconnection checks authoritative duplicates and checks again immediately before application', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page);
  let checks = 0;
  let applied = 0;
  await page.route('**/api/notes/duplicates', (route) => {
    checks++;
    return route.fulfill({
      json: {
        matches:
          checks === 1
            ? []
            : [
                {
                  term: 'fresh',
                  noteId: offlineNoteId,
                  noteType: 'vocab',
                  deckId: offlineDeckId,
                  written: 'fresh',
                },
              ],
      },
    });
  });
  await page.route('**/api/imports**', (route) => {
    applied++;
    return route.fulfill({ json: { notes: 1, cards: 1 } });
  });
  await fixture.disconnect();
  await page.locator('textarea').fill('fresh — meaning');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  expect(checks).toBe(0);
  await fixture.reconnect();
  await expect(page.getByText(/^Duplicates checked with the server/)).toBeVisible();
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect(page.getByText(/^Server duplicates have changed/)).toBeVisible();
  expect(applied).toBe(0);
  await page.getByLabel('Default for duplicates', { exact: true }).selectOption('create');
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  expect(checks).toBeGreaterThanOrEqual(3);
});

test('quota failure keeps the source and blocks navigation until a durable retry', async ({
  page,
}) => {
  await installOfflineImportFixtures(page);
  await page.locator('textarea').fill('Earlier — saved');
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreImportStorage: () => void }).restoreImportStorage = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'meta' && String(args[1]).startsWith('import-draft:'))
        throw new DOMException('Full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.locator('textarea').fill('Latest — still here');
  await expect(page.getByText(/^The latest draft could not be saved/)).toBeVisible();
  expect((await storedDrafts(page))[0]?.preparation.raw).toBe('Earlier — saved');
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save this draft before leaving' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue('Latest — still here');
  await page.evaluate(() =>
    (window as unknown as { restoreImportStorage: () => void }).restoreImportStorage(),
  );
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  expect((await storedDrafts(page))[0]?.preparation.raw).toBe('Latest — still here');
});

test('unavailable persistence leaves offline parsing usable without claiming a saved draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('Disabled', 'SecurityError');
    };
  });
  await installFixtures(page);
  await page.goto(`/import?deckId=${IMPORT_DECK_ID}`);
  await expect(page.getByText(/^Saved drafts could not be read/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.locator('textarea').fill('Local — preview');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByText('Local', { exact: true })).toBeVisible();
  await expect(page.getByText(/^The latest draft could not be saved/)).toBeVisible();
  await expect(page.getByText(/^Draft saved on this device/)).toHaveCount(0);
});

test('switching accounts hides saved drafts, and sign-out revokes access while retaining the originating draft', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page);
  await page.locator('textarea').fill('Private source — account one');
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  fixture.control.who = { ...draftAccount, id: 'user_2' };
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Saved import drafts', exact: true })).toHaveCount(
    0,
  );
  fixture.control.who = draftAccount;
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('Private source — account one');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await fixture.disconnect();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto(`/import?deckId=${offlineDeckId}`);
  await expect(page.locator('textarea')).toHaveCount(0);
  expect((await storedDrafts(page))[0]?.preparation.raw).toBe('Private source — account one');
});

test('an interrupted saved import reopens with original batch and note IDs, then retains Undo', async ({
  page,
}) => {
  await installOfflineImportFixtures(page);
  const attempts: string[][] = [];
  const batches: string[] = [];
  await page.route('**/api/imports**', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (route.request().url().endsWith('/notes')) {
        attempts.push(body.notes.map((row: { id: string }) => row.id));
        if (attempts.length === 1) return route.abort('failed');
      } else if (!route.request().url().endsWith('/undo')) batches.push(body.id);
    }
    return route.fulfill({ json: { notes: 2, cards: 2, reviewedCards: 0 } });
  });
  await page.locator('textarea').fill('one — first\ntwo — second');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByRole('button', { name: /^Import 2/ }).click();
  await expect(page.getByRole('button', { name: 'Carry on from where it stopped' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  await expect(page.getByText('Import complete', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(new Set(batches).size).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Take this import back', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Take this import back', exact: true })
    .click();
  await expect(page.getByText('Import complete', { exact: true })).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveValue('one — first\ntwo — second');
});

test('leaving immediately saves preparation and the normal Import entry reopens it', async ({
  page,
}) => {
  const fixture = await installOfflineImportFixtures(page);
  await fixture.disconnect();
  await page.locator('textarea').fill('Navigation — unfinished source');
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /^Offline import deck/ }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue('Navigation — unfinished source');
  expect((await storedDrafts(page))[0]?.preparation.raw).toBe('Navigation — unfinished source');
});

test('reopening prefers the last selected saved draft even when another draft is newer', async ({
  page,
}) => {
  await installOfflineImportFixtures(page);
  await page.locator('textarea').fill('First — older draft');
  await page.getByRole('button', { name: 'New import draft', exact: true }).click();
  await page.locator('textarea').fill('Second — newer draft');
  await page.getByRole('button', { name: 'Saved import drafts', exact: true }).click();
  await page.getByRole('button', { name: /^Draft 1 · Offline import deck/ }).click();
  await expect(page.locator('textarea')).toHaveValue('First — older draft');
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('First — older draft');
  expect(await storedDrafts(page)).toHaveLength(2);
});

test('a newer tab wins safely and the other tab can save its changes as a separate draft', async ({
  page,
  context,
}) => {
  await installOfflineImportFixtures(page);
  await page.locator('textarea').fill('Original — shared draft');
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  const other = await context.newPage();
  await installOfflineImportFixtures(other);
  await expect(other.locator('textarea')).toHaveValue('Original — shared draft');
  await other.locator('textarea').fill('Newer — another tab');
  await other.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(other.getByText(/^Draft saved on this device/)).toBeVisible();
  await page.locator('textarea').fill('Retained — this tab');
  await expect(page.getByText(/^Another window saved a newer version/)).toBeVisible();
  expect((await storedDrafts(page))[0]?.preparation.raw).toBe('Newer — another tab');
  await page
    .getByRole('button', { name: 'Save these changes as a separate draft', exact: true })
    .click();
  await expect(page.locator('textarea')).toHaveValue('Retained — this tab');
  expect((await storedDrafts(page)).map((draft) => draft.preparation.raw).sort()).toEqual([
    'Newer — another tab',
    'Retained — this tab',
  ]);
  await other.close();
});

test('a tab that loses its first frozen checkpoint can preserve its preparation separately', async ({
  page,
  context,
}) => {
  await installOfflineImportFixtures(page);
  await page.locator('textarea').fill('Original — shared draft');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
  await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
  const other = await context.newPage();
  await installOfflineImportFixtures(other, true, true);
  await expect(other.getByRole('button', { name: /^Import 1/ })).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let checking = false;
  let writes = 0;
  await page.route('**/api/notes/duplicates', async (route) => {
    checking = true;
    await held;
    await route.fulfill({ json: { matches: [] } }).catch(() => undefined);
  });
  await page.route('**/api/imports**', (route) => {
    writes++;
    return route.fulfill({ json: {} });
  });
  try {
    await page.getByRole('button', { name: /^Import 1/ }).click();
    await expect.poll(() => checking).toBe(true);
    await other.getByRole('button', { name: 'Back', exact: true }).click();
    await other.locator('textarea').fill('Newer — another tab');
    await other.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
    await expect(other.getByText(/^Draft saved on this device/)).toBeVisible();
    release();
    await expect(page.getByText(/^Another window saved a newer version/)).toBeVisible();
    expect(writes).toBe(0);
    await page
      .getByRole('button', { name: 'Save these changes as a separate draft', exact: true })
      .click();
    const saved = await storedDrafts(page);
    expect(saved.map((draft) => draft.preparation.raw).sort()).toEqual([
      'Newer — another tab',
      'Original — shared draft',
    ]);
    expect(saved.every((draft) => !draft.delivery)).toBe(true);
  } finally {
    release();
    await other.close();
  }
});

test('a compatible collection upgrade preserves Import metadata and the synchronization stores', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('import-upgrade-seeded')) return;
    sessionStorage.setItem('import-upgrade-seeded', 'yes');
    const opened = indexedDB.open('neuron.collection:user_1', 2);
    opened.onupgradeneeded = () => {
      const db = opened.result;
      for (const name of [
        'meta',
        'outbox',
        'decks',
        'notes',
        'cards',
        'studyPresets',
        'importBatches',
        'reviews',
      ])
        db.createObjectStore(
          name,
          name === 'meta' ? undefined : { keyPath: name === 'outbox' ? 'operationId' : 'id' },
        );
      opened.transaction!.objectStore('meta').put(
        {
          format: 1,
          id: '01900000-0000-7000-8000-000000000099',
          accountId: 'user_1',
          revision: 1,
          preparation: {
            deck: '01900000-0000-7000-8000-000000000011',
            raw: 'Before upgrade — retained',
            mode: 'table',
            format: '',
            noteType: 'vocab',
            columns: [],
            left: '',
            right: '',
            resolution: 'skip',
            overrides: {},
            preview: false,
          },
        },
        'import-draft:01900000-0000-7000-8000-000000000099',
      );
    };
    opened.onsuccess = () => opened.result.close();
  });
  await installOfflineImportFixtures(page);
  await expect(page.locator('textarea')).toHaveValue('Before upgrade — retained');
  const stores = await page.evaluate(async () => {
    const opened = indexedDB.open('neuron.collection:user_1');
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    try {
      const names = [...db.objectStoreNames];
      const counts = await Promise.all(
        names.map(
          (name) =>
            new Promise<[string, number]>((resolve) => {
              const read = db.transaction(name).objectStore(name).count();
              read.onsuccess = () => resolve([name, read.result]);
            }),
        ),
      );
      return { version: db.version, counts: Object.fromEntries(counts) };
    } finally {
      db.close();
    }
  });
  expect(stores.version).toBeGreaterThan(2);
  expect(stores.counts['outbox']).toBe(0);
  expect(stores.counts['review-outbox']).toBe(0);
  expect(stores.counts['notes']).toBe(1);
  expect(stores.counts['cards']).toBe(0);
});

test('cached PWA reopens an Import draft after the actual HTTP origin stops', async ({
  browser,
}) => {
  test.skip(!process.env['CI'], 'Requires the built PWA shell.');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const since = Number(url.searchParams.get('since'));
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          url.pathname === '/api/account'
            ? draftAccount
            : url.pathname === '/api/decks'
              ? offlineTree
              : url.pathname === '/api/sync'
                ? since === 0
                  ? offlinePage
                  : { since, revision: since, hasMore: false, changes: [] }
                : url.pathname === '/api/notes/duplicates'
                  ? { matches: [] }
                  : {},
        ),
      );
      return;
    }
    const asset =
      url.pathname.startsWith('/assets/') ||
      ['/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(
        url.pathname,
      )
        ? url.pathname.slice(1)
        : 'index.html';
    try {
      response.setHeader(
        'Content-Type',
        asset.endsWith('.js')
          ? 'application/javascript'
          : asset.endsWith('.css')
            ? 'text/css'
            : asset.endsWith('.png')
              ? 'image/png'
              : asset.endsWith('.svg')
                ? 'image/svg+xml'
                : asset.endsWith('.webmanifest')
                  ? 'application/manifest+json'
                  : 'text/html',
      );
      response.end(await readFile(path.join(process.cwd(), 'dist', asset)));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing origin');
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({ serviceWorkers: 'allow', baseURL: origin });
  let page = await context.newPage();
  try {
    await page.goto(`/import?deckId=${offlineDeckId}`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.locator('textarea').fill('Haus — house');
    await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
    await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await page.reload();
    await expect(page.locator('textarea')).toHaveValue('Haus — house');
    await page.locator('textarea').fill('Haus — house\nBaum — tree');
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await page.getByRole('button', { name: 'Save draft on this device', exact: true }).click();
    await expect(page.getByText(/^Draft saved on this device/)).toBeVisible();
    await page.close();
    page = await context.newPage();
    await page.goto(`/import?deckId=${offlineDeckId}`);
    await expect(page.getByText('Baum', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import \d/ })).toBeDisabled();
    expect((await storedDrafts(page))[0]?.preparation.raw).toBe('Haus — house\nBaum — tree');
  } finally {
    await context.close();
    server.close();
  }
});
