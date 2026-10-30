const locale = 'en';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { expect, test } from '@playwright/test';

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
        body: { merge: true, noteType: 'vocab', fields: { term: 'mixed', translation: 'meaning' } },
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
      const read = db
        .transaction('meta')
        .objectStore('meta')
        .getAll(IDBKeyRange.bound('import-draft:', 'import-draft:\uffff'));
      return await new Promise<ImportDraft[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, accountId);
}

async function installOfflineImportFixtures(page: Page, complete = true) {
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
  await expect(page.getByRole('button', { name: 'Preview import', exact: true })).toBeVisible();
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
