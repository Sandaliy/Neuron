import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures } from './fixtures';
import {
  installInteractionMetrics,
  startInteractionMetrics,
  readInteractionMetrics,
} from './interaction-metrics';

import type { PendingNoteEdit } from '../src/lib/note-outbox';
import type { Page, Route } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const id = '01900000-0000-7000-8000-000000000301';
const deckId = '01900000-0000-7000-8000-000000000302';
const date = '2026-10-11T00:00:00.000Z';
const account = {
  id: 'note-writer',
  name: 'Writer',
  email: 'writer@example.test',
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
const deck = {
  id: deckId,
  kind: 'deck',
  name: 'Note deck',
  parentId: null,
  position: 0,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
};
const original = {
  id,
  deckId,
  noteTypeId: '01900000-0000-7000-8000-000000000309',
  noteType: 'vocab',
  fields: { term: 'Original word', translation: 'Original meaning' } as Record<string, unknown>,
  tags: ['original'],
  source: null,
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: date,
  updatedAt: date,
  rev: 2,
};
const card = {
  id: '01900000-0000-7000-8000-000000000304',
  noteId: id,
  deckId,
  direction: 'recognition',
  slot: 0,
  state: 'review',
  stability: 3,
  difficulty: 5,
  due: date,
  lastReview: date,
  placedDue: date,
  reps: 1,
  lapses: 0,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: date,
  resetAt: null,
  updatedAt: date,
  rev: 2,
};

async function stored(page: Page) {
  return page.evaluate(async (accountId) => {
    const opened = indexedDB.open(`neuron.collection:${accountId}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const read = db.transaction('outbox').objectStore('outbox').getAll();
      return await new Promise<PendingNoteEdit[]>((resolve, reject) => {
        read.onsuccess = () =>
          resolve(
            read.result.sort((a: PendingNoteEdit, b: PendingNoteEdit) => a.sequence - b.sequence),
          );
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, account.id);
}

async function fixture(page: Page, cloze = false) {
  await installFixtures(page);
  const state = {
    offline: false,
    expired: false,
    who: account.id,
    lostAck: false,
    reject: false,
    badAck: false,
    deleted: false,
    purged: false,
    hold: undefined as Promise<void> | undefined,
    heldRead: undefined as Route | undefined,
    holdRead: false,
    patches: 0,
    deliveries: [] as Array<Record<string, unknown>>,
    receipts: new Map<string, unknown>(),
    note: {
      ...original,
      ...(cloze ? { noteType: 'cloze', fields: { text: '{{c1::One}} {{c2::Two}}' } } : {}),
    },
  };
  const cards = cloze
    ? [
        { ...card, direction: 'cloze', slot: 1 },
        { ...card, id: '01900000-0000-7000-8000-000000000305', direction: 'cloze', slot: 2 },
      ]
    : [card];
  await page.route('**/api/account', (route) =>
    state.offline
      ? route.abort('internetdisconnected')
      : state.expired
        ? route.fulfill({
            status: 401,
            json: { error: { code: 'not_authenticated', status: 401, correlationId: 'expired' } },
          })
        : route.fulfill({ json: { ...account, id: state.who } }),
  );
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      json: {
        decks:
          state.who === account.id
            ? [{ ...deck, path: [], children: [], noteCount: 1, due: 1, fresh: 0 }]
            : [],
      },
    }),
  );
  await page.route('**/api/notes?*', (route) =>
    route.fulfill({
      json: { items: state.who === account.id && !state.deleted ? [state.note] : [] },
    }),
  );
  await page.route(`**/api/notes/${id}`, (route) => {
    if (route.request().method() === 'PATCH') state.patches++;
    if (state.holdRead) {
      state.heldRead = route;
      return;
    }
    return state.offline
      ? route.abort('internetdisconnected')
      : route.fulfill({ json: { note: state.note, cards } });
  });
  await page.route('**/api/sync?*', (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    const rows =
      state.who === account.id
        ? [
            { entity: 'decks', id: deckId, rev: 1, deleted: false, purged: false, row: deck },
            {
              entity: 'notes',
              id,
              rev: state.note.rev,
              deleted: state.deleted,
              purged: state.purged,
              row: state.purged ? {} : state.note,
            },
            ...cards.map((row) => ({
              entity: 'cards',
              id: row.id,
              rev: row.rev,
              deleted: false,
              purged: false,
              row,
            })),
          ]
        : [];
    return state.offline
      ? route.abort('internetdisconnected')
      : route.fulfill({
          json: {
            since,
            revision: Math.max(since, state.who === account.id ? state.note.rev : 0),
            hasMore: false,
            changes: rows.filter((row) => row.rev > since),
          },
        });
  });
  await page.route(`**/api/notes/${id}/offline-edit`, async (route) => {
    const body = route.request().postDataJSON();
    state.deliveries.push(body);
    await state.hold;
    if (state.reject)
      return route.fulfill({
        status: 403,
        json: { error: { code: 'sync_rejected', status: 403, correlationId: 'rejected' } },
      });
    let receipt = state.receipts.get(body.operationId);
    if (!receipt) {
      const conflict = state.deleted || state.note.rev !== body.baseRev;
      if (!conflict)
        state.note = {
          ...state.note,
          fields: body.fields,
          tags: body.tags,
          rev: state.note.rev + 1,
        };
      receipt = {
        operationId: body.operationId,
        status: conflict ? 'conflict' : 'applied',
        revision: state.note.rev,
        ...(conflict ? { reason: state.deleted ? 'deleted_remotely' : 'changed_remotely' } : {}),
      };
      state.receipts.set(body.operationId, receipt);
    }
    if (state.lostAck) {
      state.lostAck = false;
      return route.fulfill({
        status: 503,
        json: { error: { code: 'internal_error', status: 503, correlationId: 'lost-ack' } },
      });
    }
    return route.fulfill({
      json: state.badAck ? { ...(receipt as object), status: 'invented' } : receipt,
    });
  });
  await page.goto('/settings');
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  return state;
}

async function disconnect(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}
async function reconnect(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}
async function editOffline(
  page: Page,
  state: Awaited<ReturnType<typeof fixture>>,
  text = 'Local meaning',
) {
  await page.goto(`/notes/${id}`);
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
    'Original meaning',
  );
  await disconnect(page, state);
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill(text);
  await expect.poll(async () => (await stored(page))[0]?.working.fields['translation']).toBe(text);
}

test('provisional editor never autosaves; typing, focus and geometry survive authority and synchronization', async ({
  page,
}) => {
  await installInteractionMetrics(page);
  const state = await fixture(page);
  state.holdRead = true;
  await page.goto(`/notes/${id}`);
  const input = page.getByRole('textbox', { name: 'Translation', exact: true });
  await expect(input).toHaveValue('Original meaning');
  await expect.poll(() => !!state.heldRead).toBe(true);
  await page
    .locator('[data-editor]')
    .evaluate((element) => element.setAttribute('data-visit', 'same'));
  await input.focus();
  await input.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(3, 3));
  const geometry = await input.boundingBox();
  expect(await stored(page)).toEqual([]);
  expect(state.patches).toBe(0);
  state.holdRead = false;
  await state.heldRead!.fulfill({ json: { note: state.note, cards: [card] } });
  await expect(page.locator('[data-visit="same"]')).toHaveCount(1);
  await expect(input).toBeFocused();
  expect(await input.boundingBox()).toEqual(geometry);
  expect(await input.evaluate((element) => (element as HTMLTextAreaElement).selectionStart)).toBe(
    3,
  );
  await disconnect(page, state);
  await startInteractionMetrics(page);
  await input.pressSequentially('New ', { delay: 30 });
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const local = await input.inputValue();
  await input.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(2, 2));
  const beforeReconnect = await input.boundingBox();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  await expect(input).toHaveValue(local);
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => (element as HTMLTextAreaElement).selectionStart)).toBe(
    2,
  );
  expect(await input.boundingBox()).toEqual(beforeReconnect);
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
  await expect(page.locator('[data-visit="same"]')).toHaveCount(1);
  const metrics = await readInteractionMetrics(page);
  expect(metrics.scans['notes'] ?? 0).toBe(0);
  expect(metrics.scans['cards'] ?? 0).toBe(0);
  expect(state.patches).toBe(0);
});

test('newer edits remain durable while a frozen delivery loses acknowledgement and retries', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state, 'First local meaning');
  const first = (await stored(page))[0]!;
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.lostAck = true;
  await reconnect(page, state);
  await expect.poll(() => state.deliveries.length).toBe(1);
  await page
    .getByRole('textbox', { name: 'Translation', exact: true })
    .fill('Newest local meaning');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('offline, corrected');
  await expect
    .poll(async () => (await stored(page))[0]?.working.tags)
    .toEqual(['offline', 'corrected']);
  expect((await stored(page))[0]!.payload).toEqual(first.payload);
  release();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('region', { name: 'Saved Note edits' })
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page)).map((entry) => entry.state))
    .toEqual(['synchronized', 'synchronized']);
  expect(state.deliveries).toHaveLength(3);
  expect(state.deliveries[0]).toEqual(first.payload);
  expect(state.deliveries[1]).toEqual(first.payload);
  expect((await stored(page))[0]!.working).toEqual({
    fields: first.payload.fields,
    tags: first.payload.tags,
  });
  const latest = (await stored(page))[1]!;
  expect(latest.operationId).not.toBe(first.operationId);
  expect(latest.payload.baseRev).toBe(3);
  expect(state.note.fields['translation']).toBe('Newest local meaning');
  expect(state.note.tags).toEqual(['offline', 'corrected']);
  await page.goto(`/notes/${id}`);
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
    'Newest local meaning',
  );
});

test('reopening after a clock correction keeps the newest durable operation visible and deliverable', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state, 'First durable meaning');
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  const first = (await stored(page))[0]!;
  await disconnect(page, state);
  await page.addInitScript(() => {
    Date.now = () => 1_600_000_000_000;
  });
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Translation', exact: true });
  await expect(input).toHaveValue('First durable meaning');
  await input.fill('Meaning after reopening');
  await expect.poll(async () => (await stored(page))[1]?.state).toBe('pending');
  const latest = (await stored(page))[1]!;
  expect(latest.operationId.localeCompare(first.operationId)).toBeLessThan(0);
  expect(latest.sequence).toBeGreaterThan(first.sequence);
  expect(latest.payload.baseRev).toBe(first.outcome!.revision);
  await page.reload();
  await expect(input).toHaveValue('Meaning after reopening');
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[1]?.state).toBe('synchronized');
  expect(state.deliveries).toHaveLength(2);
  expect(state.deliveries[1]).toEqual(latest.payload);
  expect(state.note.fields['translation']).toBe('Meaning after reopening');
});

test('confirmed online conversion and status become the baseline for later durable content edits', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route(`**/api/notes/${id}`, (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      expect(body.noteType).toBe('basic');
      expect(body.discardCards).toBe(true);
      state.note = { ...state.note, noteType: 'basic', fields: body.fields, rev: 3 };
      state.patches++;
    }
    return route.fulfill({ json: { note: state.note, cards: state.patches === 0 ? [card] : [] } });
  });
  await page.goto(`/notes/${id}`);
  await page.getByRole('radio', { name: 'Question', exact: true }).press('Space');
  await page.getByRole('textbox', { name: 'Front', exact: true }).fill('Converted question');
  await page.getByRole('textbox', { name: 'Back', exact: true }).fill('Converted answer');
  await page.getByRole('button', { name: 'Apply type change', exact: true }).click();
  // The fixture starts with an answered Card: keep explicit online confirmation.
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Replace cards and change type', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.patches).toBe(1);
  await disconnect(page, state);
  await page.getByRole('textbox', { name: 'Back', exact: true }).fill('Offline correction');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const edit = (await stored(page))[0]!;
  expect(edit.payload.baseRev).toBe(3);
  expect(edit.base.row['noteType']).toBe('basic');
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.note.fields['back']).toBe('Offline correction');
  await page.route('**/api/notes/status', (route) => {
    state.note = { ...state.note, status: 'known', rev: 5 };
    return route.fulfill({ json: { changed: 1 } });
  });
  const freshStatus = page.waitForResponse(
    async (response) =>
      response.url().endsWith(`/api/notes/${id}`) &&
      response.request().method() === 'GET' &&
      (await response.json()).note.rev === 5,
  );
  await page.getByRole('button', { name: 'Mark as known', exact: true }).click();
  await freshStatus;
  // Allow the confirmed row to reach the mounted form before disconnecting.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('button', { name: 'Mark as known', exact: true })).toBeDisabled();
  await disconnect(page, state);
  await page.getByRole('textbox', { name: 'Back', exact: true }).fill('Correction after status');
  await expect.poll(async () => (await stored(page))[1]?.state).toBe('pending');
  expect((await stored(page))[1]!.payload.baseRev).toBe(5);
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[1]?.state).toBe('synchronized');
});

test('a remote conversion preserves the original draft form and requires recovery without applying it across types', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  const first = (await stored(page))[0]!;
  state.note = {
    ...state.note,
    noteType: 'basic',
    fields: { front: 'Remote question', back: 'Remote answer' },
    rev: 3,
  };
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('conflict');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Word', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
    'Local meaning',
  );
  await disconnect(page, state);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
    'Local meaning',
  );
  await reconnect(page, state);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Apply draft to current Note', exact: true }).click();
  await expect(
    page.getByText(
      'The Note type or Deck changed. This draft cannot be applied across that change. Copy it or keep the server version and archive the draft.',
      { exact: true },
    ),
  ).toBeVisible();
  expect((await stored(page))[0]!.base).toEqual(first.base);
  expect((await stored(page))[0]!.working).toEqual(first.working);
  expect(await stored(page)).toHaveLength(1);
  expect(state.deliveries).toHaveLength(1);
  expect(state.note.fields).toEqual({ front: 'Remote question', back: 'Remote answer' });
  await page
    .getByRole('button', { name: 'Keep server version and archive draft', exact: true })
    .click();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('resolved');
  await page.goto(`/notes/${id}`);
  await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toHaveValue(
    'Remote question',
  );
  expect((await stored(page))[0]!.working).toEqual(first.working);
  expect(state.deliveries).toHaveLength(1);
});

test('original revision and both versions survive remote conflict; recovery requires a new operation', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/notes/${id}`);
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
    'Original meaning',
  );
  await disconnect(page, state);
  // A concurrent pull may advance storage without advancing the mounted form's base.
  state.note = {
    ...state.note,
    rev: 3,
    fields: { term: 'Original word', translation: 'Remote meaning' },
  };
  await page.evaluate(
    async ({ accountId, note }) => {
      const opened = indexedDB.open(`neuron.collection:${accountId}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        opened.onsuccess = () => resolve(opened.result);
      });
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').put({
        entity: 'notes',
        id: note.id,
        rev: note.rev,
        deleted: false,
        purged: false,
        row: note,
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { accountId: account.id, note: state.note },
  );
  await page
    .getByRole('textbox', { name: 'Translation', exact: true })
    .fill('Losing local meaning');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const first = (await stored(page))[0]!;
  expect(first.payload.baseRev).toBe(2);
  expect(first.base.row['fields']).toEqual(original.fields);
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('conflict');
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
    'Losing local meaning',
  );
  await page.getByRole('link', { name: 'Needs review', exact: true }).click();
  await page.getByText('Current version').click();
  await expect(page.getByText('Remote meaning', { exact: true })).toBeVisible();
  expect(state.note.fields['translation']).toBe('Remote meaning');
  await page.getByRole('button', { name: 'Apply draft to current Note', exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).map((entry) => entry.state))
    .toEqual(['resolved', 'synchronized']);
  expect((await stored(page))[0]!.payload).toEqual(first.payload);
  expect((await stored(page))[0]!.base).toEqual(first.base);
  expect(state.note.fields['translation']).toBe('Losing local meaning');
});

for (const purged of [false, true])
  test(`remote ${purged ? 'purge' : 'deletion'} retains the draft and never restores the Note`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await editOffline(page, state);
    state.deleted = true;
    state.purged = purged;
    state.note.rev = 3;
    await reconnect(page, state);
    await expect
      .poll(async () => (await stored(page))[0]?.outcome?.reason)
      .toBe('deleted_remotely');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Apply draft to current Note', exact: true }),
    ).toHaveCount(0);
    const before = (await stored(page))[0]!;
    await page
      .getByRole('button', { name: 'Keep server version and archive draft', exact: true })
      .click();
    await expect.poll(async () => (await stored(page))[0]?.state).toBe('resolved');
    expect((await stored(page))[0]!.working).toEqual(before.working);
    expect((await stored(page))[0]!.base).toEqual(before.base);
    expect(state.deleted).toBe(true);
  });

test('incomplete fields and excessive tags stay as raw drafts across reload without delivery', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('');
  const tags = Array.from({ length: 51 }, (_, at) => `tag-${at}`).join(', ');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill(tags);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('draft');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Tags', exact: true })).toHaveValue(tags);
  await reconnect(page, state);
  expect(state.deliveries).toEqual([]);
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Corrected word');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('corrected');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
});

test('definitions, examples, tags and accepted answers save through the familiar editor without blur', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  await page.getByRole('textbox', { name: 'Definition', exact: true }).fill('A local definition');
  await page.getByRole('textbox', { name: 'Example', exact: true }).fill('A local example.');
  await page
    .getByRole('textbox', { name: 'Example, translated', exact: true })
    .fill('A translated example.');
  await page.getByRole('combobox', { name: 'Part of speech', exact: true }).selectOption('noun');
  await page.getByRole('button', { name: 'Study directions', expanded: false }).click();
  // A person types once the section has opened; a field still clipped to the
  // first frames of the opening cannot be tapped.
  await expect(page.locator('.neu-disclosure[data-moving="true"]')).toHaveCount(0);
  const answers = page.getByRole('textbox', {
    name: 'Accepted production answers, one per line',
    exact: true,
  });
  await answers.fill('First answer');
  await answers.press('Enter');
  await answers.pressSequentially('Second answer', { delay: 10 });
  await expect(answers).toHaveValue('First answer\nSecond answer');
  await expect(answers).toBeFocused();
  await expect
    .poll(async () => (await stored(page))[0]?.working.fields)
    .toMatchObject({
      definition: 'A local definition',
      example: 'A local example.',
      exampleTranslation: 'A translated example.',
      partOfSpeech: 'noun',
      acceptedAnswers: ['First answer', 'Second answer'],
    });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Definition', exact: true })).toHaveValue(
    'A local definition',
  );
  await page.getByRole('button', { name: 'Study directions', expanded: false }).click();
  await expect(answers).toHaveValue('First answer\nSecond answer');
  expect(state.deliveries).toEqual([]);
});

test('storage failure retains the visible draft, reports failure and allows a durable retry', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  const saved = (await stored(page))[0]!;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'outbox') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Injected quota', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  const input = page.getByRole('textbox', { name: 'Translation', exact: true });
  await input.fill('Draft after storage failure');
  // Navigate before the debounce. A failed flush must leave its form mounted.
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByRole('button', { name: /Not saved/ })).toBeVisible();
  expect((await stored(page))[0]!.working).toEqual(saved.working);
  await expect(input).toHaveValue('Draft after storage failure');
  await page.getByRole('button', { name: /Not saved/ }).click();
  await expect
    .poll(async () => (await stored(page))[0]?.working.fields['translation'])
    .toBe('Draft after storage failure');
  expect(state.deliveries).toEqual([]);
});

test('session expiry and account switching retain pending work; matching sign-in recovers it', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  state.expired = true;
  await reconnect(page, state);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.deliveries).toEqual([]);
  state.expired = false;
  state.who = 'another-note-writer';
  await page.evaluate(() => localStorage.removeItem('neuron.offline.signedOut'));
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved Note edits' })).toHaveCount(0);
  expect((await stored(page))[0]?.state).toBe('pending');
  expect(state.deliveries).toEqual([]);
  state.who = account.id;
  await page.goto('/settings');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.deliveries).toHaveLength(1);
});

test('an unreadable upgraded outbox preserves the mounted form and blocks unsafe saves', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  const saved = await stored(page);
  const input = page.getByRole('textbox', { name: 'Translation', exact: true });
  await input.focus();
  await page
    .locator('[data-editor]')
    .evaluate((element) => element.setAttribute('data-storage-visit', 'same'));
  await page.evaluate(
    async ({ accountId, entityId }) => {
      const opened = indexedDB.open(`neuron.collection:${accountId}`, 4);
      await new Promise<void>((resolve, reject) => {
        opened.onsuccess = () => {
          opened.result.close();
          resolve();
        };
        opened.onerror = () => reject(opened.error);
      });
      const channel = new BroadcastChannel('neuron.notes.changed');
      channel.postMessage({ accountId, entityId, version: 2 });
      channel.close();
    },
    { accountId: account.id, entityId: id },
  );
  await expect(
    page.getByText(
      'Saved changes could not be read. Rebuild is blocked until they can be checked safely.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('[data-storage-visit="same"]')).toHaveCount(1);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Local meaning');
  await input.fill('Visible unsaved draft');
  await expect(page.getByRole('button', { name: /Not saved/ })).toBeVisible();
  await expect(input).toHaveValue('Visible unsaved draft');
  expect(await stored(page)).toEqual(saved);
  expect(state.deliveries).toEqual([]);
});

test('explicit offline sign-out cannot deliver Note drafts from a still-valid cookie', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  const saved = await stored(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  state.offline = false;
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await stored(page)).toEqual(saved);
  expect(state.deliveries).toEqual([]);
});

test('an account switch during delivery ignores a late acknowledgement and retains the original command', async ({
  page,
}) => {
  const state = await fixture(page);
  await editOffline(page, state);
  const saved = (await stored(page))[0]!;
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await reconnect(page, state);
  await expect.poll(() => state.deliveries.length).toBe(1);
  state.who = 'another-note-writer';
  await page.goto('/settings');
  // Revalidation selects a different account before the old write responds.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('neuron.offline.account')))
    .toBe(state.who);
  release();
  await expect(page.getByRole('region', { name: 'Saved Note edits' })).toHaveCount(0);
  expect((await stored(page))[0]!.payload).toEqual(saved.payload);
  expect((await stored(page))[0]!.state).toBe('pending');
  expect(state.deliveries).toHaveLength(1);
  const foreign = await page.evaluate(async (accountId) => {
    const opened = indexedDB.open(`neuron.collection:${accountId}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const read = db.transaction('outbox').objectStore('outbox').getAll();
    const entries = await new Promise<unknown[]>((resolve) => {
      read.onsuccess = () => resolve(read.result);
    });
    db.close();
    return entries;
  }, state.who);
  expect(foreign).toEqual([]);
  state.who = account.id;
  await page.goto('/settings');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.deliveries[1]).toEqual(saved.payload);
});

test('Card-removing edits remain unsupported drafts; Rebuild cannot remove them', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await page.goto(`/notes/${id}`);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(
    '{{c1::One}} {{c2::Two}}',
  );
  await disconnect(page, state);
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('{{c1::One}} Two');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('unsupported');
  state.note.rev++;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'notes')
        throw new DOMException('Injected pull quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await reconnect(page, state);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild downloaded collection', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild now', exact: true }).click();
  await expect(
    page.getByText(
      'Rebuild is blocked because saved changes have not synchronized or been resolved. Recover them first.',
      { exact: true },
    ),
  ).toBeVisible();
  expect((await stored(page))[0]!.working.fields['text']).toBe('{{c1::One}} Two');
  expect(state.deliveries).toEqual([]);
  expect(state.note.fields['text']).toBe('{{c1::One}} {{c2::Two}}');
});

for (const malformed of [false, true])
  test(`${malformed ? 'malformed acknowledgement stays pending' : 'rejected update never appears synchronized'}`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await editOffline(page, state);
    state.reject = !malformed;
    state.badAck = malformed;
    await reconnect(page, state);
    await expect.poll(() => state.deliveries.length).toBe(1);
    await expect
      .poll(async () => (await stored(page))[0]?.state)
      .toBe(malformed ? 'pending' : 'rejected');
    await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveValue(
      'Local meaning',
    );
    await expect(page.getByText('Synced with server', { exact: true })).toHaveCount(0);
    if (!malformed) {
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(
        page.getByText(
          'The server rejected this update. Your local draft is retained; copy it or keep the server version and archive the draft.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          'This Note changed elsewhere. Compare the versions before applying your draft to the current Note.',
          { exact: true },
        ),
      ).toHaveCount(0);
    }
  });

test('small and large saved Note histories stay compact by default and disclose retained versions accessibly', async ({
  page,
}, info) => {
  const state = await fixture(page);
  await editOffline(page, state);
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const region = page.getByRole('region', { name: 'Saved Note edits' });
  await expect(
    page.getByText('Everything is saved to your account.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recent activity', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(region.getByRole('button', { name: 'Copy saved draft', exact: true })).toHaveCount(
    0,
  );
  await expect(region.getByText(/Original server revision/)).toHaveCount(0);
  const saved = (await stored(page))[0]!;
  await page.evaluate(
    async ({ accountId, saved }) => {
      const opened = indexedDB.open(`neuron.collection:${accountId}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        opened.onsuccess = () => resolve(opened.result);
      });
      const tx = db.transaction('outbox', 'readwrite');
      for (let index = 1; index <= 249; index++) {
        const operationId = `01900000-0000-7000-8000-${index.toString().padStart(12, '0')}`;
        tx.objectStore('outbox').put({
          ...saved,
          operationId,
          sequence: saved.sequence + index,
          payload: { ...saved.payload, operationId },
          outcome: { ...saved.outcome, operationId },
          working: {
            ...saved.working,
            fields: { ...saved.working.fields, term: `Saved receipt ${index}` },
          },
        });
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { accountId: account.id, saved },
  );
  await page.reload();
  await expect(region.getByRole('button', { name: 'Copy saved draft', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Recent activity', exact: true }).click();
  await expect(region.getByRole('button', { name: /Saved receipt/ })).toHaveCount(10);
  // Recent activity must have finished opening, and resizing to the receipts
  // that load after it opens, before the nested section is measured.
  await expect
    .poll(() =>
      page.getByRole('button', { name: 'Recent activity', exact: true }).evaluate((button) => {
        const body = document.getElementById(button.getAttribute('aria-controls')!)!;
        return (
          body.dataset['disclosureOpen'] === 'true' &&
          body.dataset['moving'] === 'false' &&
          body.getAnimations({ subtree: true }).length === 0
        );
      }),
    )
    .toBe(true);
  const frames = await region
    .getByRole('button', { name: /Saved receipt/ })
    .first()
    .evaluate(async (button) => {
      const content = document.getElementById(button.getAttribute('aria-controls')!)!;
      const fade = content.querySelector('.neu-disclosure-content')!;
      const parent = content.parentElement!.closest('.neu-disclosure') as HTMLElement;
      const parentContent = parent.querySelector('.neu-disclosure-content')!;
      const frames: Array<{
        opacity: number;
        complete: boolean;
        parentFollows: boolean;
        clippedUnits: number;
      }> = [];
      (button as HTMLButtonElement).click();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const sample = () => {
          const boundary = content.getBoundingClientRect().bottom;
          const clippedUnits = Array.from(
            fade.querySelectorAll('label, input, textarea, select, button, p'),
          ).filter((unit) => {
            // A closed section nested inside keeps layout boxes it does not paint.
            if (unit.closest('[data-disclosure-open="false"]')) return false;
            const bounds = unit.getBoundingClientRect();
            return bounds.height > 0 && bounds.top < boundary - 1 && bounds.bottom > boundary + 1;
          }).length;
          frames.push({
            clippedUnits,
            opacity: Number(getComputedStyle(fade).opacity),
            complete:
              content.getBoundingClientRect().height >= fade.getBoundingClientRect().height - 1,
            // The open parent grows with the nested body instead of cutting it off.
            parentFollows:
              parent.getBoundingClientRect().height >=
              parentContent.getBoundingClientRect().height - 1,
          });
          if (performance.now() - start < 800) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return frames;
    });
  await info.attach('nested-history-reveal-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  expect(frames.some((frame) => frame.opacity > 0.05 && !frame.complete)).toBe(true);
  expect(frames.every((frame) => frame.clippedUnits === 0 || frame.opacity < 0.99)).toBe(true);
  expect(frames.every((frame) => frame.parentFollows)).toBe(true);
  expect(frames.at(-1)).toMatchObject({ complete: true, opacity: 1 });
  await expect(region.getByRole('button', { name: 'Copy saved draft', exact: true })).toHaveCount(
    1,
  );
  await expect(region.locator('[data-moving="true"]')).toHaveCount(0);
  await region
    .getByRole('button', { name: 'Copy saved draft', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    region.getByRole('button', { name: 'Copy saved draft', exact: true }),
  ).toBeInViewport();
  expect(await stored(page)).toHaveLength(250);
  await page.screenshot({ path: info.outputPath('compact-note-history.png') });
});
