import { expect, test } from '@playwright/test';

import { planDownloadedStudy } from '../src/lib/offline-study-snapshot';

import {
  storedStudyEvents,
  useFixtures as installFixtures,
  usePreferences as installPreferences,
} from './fixtures';
import {
  installInteractionMetrics,
  readInteractionMetrics,
  startInteractionMetrics,
} from './interaction-metrics';

import type { StudySnapshot } from '../src/lib/offline-study-snapshot';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const owner = 'offline-study-browser';
const past = '2026-09-01T12:00:00.000Z';
function collection(count = 4): StudySnapshot {
  const decks = [1, 2].map((n) => ({
    entity: 'decks' as const,
    id: id(n),
    rev: 4,
    deleted: false,
    purged: false,
    row: {
      id: id(n),
      kind: 'deck',
      name: `Offline ${n === 1 ? 'German' : 'English'}`,
      parentId: null,
      position: n,
      settings: {
        targetLanguage: n === 1 ? 'de' : 'en',
        ladder: [
          { direction: 'recognition', opensAtStability: 0 },
          { direction: 'production', opensAtStability: 0 },
          { direction: 'listening', opensAtStability: 0 },
        ],
      },
      createdAt: past,
      updatedAt: past,
      rev: 4,
    },
  }));
  const notes = Array.from({ length: count }, (_, n) => ({
    entity: 'notes' as const,
    id: id(10 + n),
    rev: 4,
    deleted: false,
    purged: false,
    row: {
      id: id(10 + n),
      deckId: id((n % 2) + 1),
      noteTypeId: id(99),
      noteType: 'vocab',
      fields: { term: `Wort ${n}`, translation: `Meaning ${n}` },
      tags: [],
      source: null,
      rank: null,
      status: 'active',
      importBatchId: null,
      createdAt: past,
      updatedAt: past,
      rev: 4,
    },
  }));
  const cards = notes.flatMap((note, n) =>
    (['recognition', 'production', 'listening'] as const).map((direction, d) => ({
      entity: 'cards' as const,
      id: id(100 + n * 3 + d),
      rev: 4,
      deleted: false,
      purged: false,
      row: {
        id: id(100 + n * 3 + d),
        noteId: note.id,
        deckId: note.row.deckId,
        direction,
        slot: 0,
        state: 'new',
        stability: null,
        difficulty: null,
        due: past,
        lastReview: null,
        reps: 0,
        lapses: 0,
        learningStep: 0,
        suspendedAt: null,
        unlockedAt: past,
        resetAt: null,
        updatedAt: past,
        rev: 4,
      },
    })),
  );
  const result: StudySnapshot = {
    account: {
      id: owner,
      name: 'Learner',
      email: 'learner@example.test',
      image: null,
      locale: 'en',
      theme: 'dark',
      timezone: 'UTC',
      dayCutoffHour: 4,
      plan: 'free',
      settings: { budgetMinutes: [20, 20, 20, 20, 20, 20, 20], maximumNewCardsPerDay: 1 },
      twoFactorEnabled: false,
      revision: 4,
    },
    cursor: 4,
    complete: true,
    reviewSequence: 0,
    decks,
    notes,
    cards,
    reviews: [],
    edits: [],
    events: [],
  };
  const changes = [...decks, ...notes, ...cards];
  changes.forEach((change, at) => {
    change.rev = Math.floor(at / 1000) + 1;
    change.row.rev = change.rev;
  });
  result.cursor = Math.ceil(changes.length / 1000);
  (result.account as { revision: number }).revision = result.cursor;
  return result;
}
async function fixture(page: Page, count = 4) {
  const data = collection(count);
  const state = { offline: false, plans: 0, writes: 0, expired: false };
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  await installFixtures(page);
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (state.offline) return route.abort('internetdisconnected');
      if (path === '/api/account')
        return route.fulfill({
          status: state.expired ? 401 : 200,
          json: state.expired
            ? { error: { code: 'not_authenticated', status: 401, correlationId: 'expired' } }
            : data.account,
        });
      if (path === '/api/decks')
        return route.fulfill({
          json: {
            decks: data.decks.map((row) => ({
              ...row.row,
              path: [],
              children: [],
              noteCount: count / 2,
              due: 0,
              fresh: (count / 2) * 3,
            })),
          },
        });
      if (path === '/api/sync') {
        const since = Number(new URL(route.request().url()).searchParams.get('since') ?? 0);
        const remaining = [...data.decks, ...data.notes, ...data.cards].filter(
          (row) => row.rev > since,
        );
        const revision = remaining[0]?.rev ?? data.cursor;
        return route.fulfill({
          json: {
            since,
            revision,
            hasMore: revision < data.cursor,
            changes: remaining.filter((row) => row.rev === revision),
          },
        });
      }
      if (path === '/api/study/session') {
        state.plans++;
        return route.fulfill({
          json: planDownloadedStudy(data, owner, route.request().postDataJSON(), new Date()),
        });
      }
      if (route.request().method() !== 'GET') state.writes++;
      return route.fallback();
    },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await expect
    .poll(
      () =>
        page.evaluate(async (owner) => {
          const open = indexedDB.open(`neuron.collection:${owner}`);
          const db = await new Promise<IDBDatabase>((resolve) => {
            open.onsuccess = () => resolve(open.result);
          });
          const request = db.transaction('meta').objectStore('meta').get('sync');
          const value = await new Promise<boolean>((resolve) => {
            request.onsuccess = () => resolve(request.result?.complete === true);
          });
          db.close();
          return value;
        }, owner),
      { timeout: 30_000 },
    )
    .toBe(true);
  // The durable marker commits just before the download controller publishes
  // readiness. Wait for that public state before cutting the connection.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(
    page.getByText('Available from your download. Answers save on this device.'),
  ).toBeVisible();
  return { data, state };
}
async function setup(page: Page) {
  const control = page.getByRole('button', { name: /Study setup/ });
  if ((await control.getAttribute('aria-expanded')) !== 'true') await control.click();
}

test('cold local setup, answer, Undo, completion and subsequent sitting use committed history without a planning request', async ({
  page,
}) => {
  const { state } = await fixture(page);
  const onlinePlans = state.plans;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await setup(page);
  await page.getByLabel('Study language').selectOption('de');
  await page.getByLabel('Study mode').selectOption('recognition');
  await page.getByLabel('Time for this session').selectOption('5');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect.poll(async () => (await storedStudyEvents(page, owner)).length).toBe(3);
  const saved = await storedStudyEvents(page, owner);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
  await setup(page);
  await page.getByLabel('Study language').selectOption('en');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeDisabled();
  expect((await storedStudyEvents(page, owner)).map((event) => event.event)).toEqual(
    saved.map((event) => event.event),
  );
  expect(state.plans).toBe(onlinePlans);
  expect(state.writes).toBe(0);
});

test('Typing and device-local Listening use the familiar card and native submit path offline', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const voices = [
      {
        name: 'Local German',
        lang: 'de-DE',
        voiceURI: 'local-de',
        default: true,
        localService: true,
      },
    ];
    const speech = new EventTarget();
    Object.assign(speech, {
      getVoices: () => voices,
      speak: () => undefined,
      cancel: () => undefined,
    });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
  });
  await fixture(page);
  await setup(page);
  await page.getByLabel('Study mode').selectOption('production');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
  const input = page.getByRole('textbox');
  await input.fill('Wort 0');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: /^Easy / })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await setup(page);
  await page.getByLabel('Study mode').selectOption('listening');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play audio' })).toBeEnabled();
  await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeVisible();
});

test('mismatched settings restrict new admission without enabling offline override', async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(async (owner) => {
    const open = indexedDB.open(`neuron.collection:${owner}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const tx = db.transaction('meta', 'readwrite');
    const get = tx.objectStore('meta').get('account');
    get.onsuccess = () => tx.objectStore('meta').put({ ...get.result, revision: 3 }, 'account');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, owner);
  await page.reload();
  await expect(
    page.getByText('New cards need matching downloaded settings. Connect to update your download.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeDisabled();
  await setup(page);
  await expect(
    page.getByRole('checkbox', { name: 'Include more new material this time' }),
  ).toHaveCount(0);
});

test('an incomplete download and a known expired account cannot start local Study', async ({
  page,
}) => {
  const { state } = await fixture(page);
  await page.evaluate(async (owner) => {
    const open = indexedDB.open(`neuron.collection:${owner}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const tx = db.transaction('meta', 'readwrite');
    const get = tx.objectStore('meta').get('sync');
    get.onsuccess = () => tx.objectStore('meta').put({ ...get.result, complete: false }, 'sync');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, owner);
  await page.reload();
  await expect(
    page.getByText('Finish downloading your collection online before starting Study offline.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toHaveCount(0);
  state.offline = false;
  state.expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(/sign-in/);
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toHaveCount(0);
});

test('sign-out revokes a local plan and keeps committed work in its original account', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect.poll(async () => (await storedStudyEvents(page, owner)).length).toBe(1);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  const saved = await storedStudyEvents(page, owner);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goto('/');
  await expect(page).toHaveURL(/sign-in/);
  expect((await storedStudyEvents(page, owner)).map((entry) => entry.event)).toEqual(
    saved.map((entry) => entry.event),
  );
});

test('local planning does no collection scans on the UI thread and retains responsive setup at 5,000 Notes', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'The 4x CPU large-collection measurement requires Chromium CDP.',
  );
  test.setTimeout(60_000);
  await installInteractionMetrics(page);
  await fixture(page, 5000);
  const session = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined;
  await session?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await startInteractionMetrics(page);
  const at = Date.now();
  await setup(page);
  await page.getByLabel('Study language').selectOption('en');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  const setupReadyMs = Date.now() - at;
  expect(setupReadyMs).toBeLessThan(5000);
  const enteredAt = Date.now();
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
  const studyEntryMs = Date.now() - enteredAt;
  expect(studyEntryMs).toBeLessThan(5000);
  const metrics = await readInteractionMetrics(page);
  expect(metrics.scans).toEqual({});
  console.log(JSON.stringify({ offlineStudy: { setupReadyMs, studyEntryMs, metrics } }));
  await info.attach('offline-planning-ui-thread', {
    body: JSON.stringify({ setupReadyMs, studyEntryMs, metrics }),
    contentType: 'application/json',
  });
  await session?.detach();
});
