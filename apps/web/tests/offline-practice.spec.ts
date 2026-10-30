import { expect, test } from '@playwright/test';

import { advancePractice, reconcilePractice } from '@neuron/shared';
import type { PracticeCommand, PracticeNote, PracticeRun } from '@neuron/shared';

import {
  storedPractice,
  useFixtures as installFixtures,
  usePreferences as installPreferences,
} from './fixtures';

import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const owner = 'offline-practice-browser';
const past = '2026-09-01T12:00:00.000Z';
const deckId = id(1);
const account = {
  id: owner,
  name: 'Learner',
  email: 'learner@example.test',
  image: null,
  locale: 'en',
  theme: 'dark',
  timezone: 'UTC',
  dayCutoffHour: 4,
  plan: 'free',
  settings: { budgetMinutes: [20, 20, 20, 20, 20, 20, 20] },
  twoFactorEnabled: false,
  revision: 2,
};
const deckRow = {
  id: deckId,
  kind: 'deck',
  name: 'Offline words',
  parentId: null,
  position: 0,
  settings: { targetLanguage: 'de' },
  createdAt: past,
  updatedAt: past,
  rev: 1,
};
const noteRows = [0, 1, 2].map((n) => ({
  id: id(10 + n),
  deckId,
  noteTypeId: id(99),
  noteType: 'vocab',
  fields: { term: `Wort ${n}`, translation: `Meaning ${n}` },
  tags: [],
  source: null,
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: `2026-09-01T12:00:0${n}.000Z`,
  updatedAt: past,
  rev: 2,
}));
const refused = {
  status: 409,
  json: { error: { code: 'sync_rejected', status: 409, correlationId: 'test' } },
};

/**
 * The api as the real one behaves for Practice: commands carry the version they were built on,
 * an exact retry is answered from its receipt, and a Note that left the pool is skipped.
 */
async function fixture(page: Page) {
  const server = {
    offline: false,
    expired: false,
    loseNext: false,
    run: null as PracticeRun | null,
    version: 0,
    pool: noteRows.map((row) => ({ id: row.id, fields: row.fields })) as PracticeNote[],
    receipts: new Map<string, string>(),
    applied: [] as PracticeCommand[],
    posted: [] as string[],
  };
  const current = () => (server.run ? reconcilePractice(server.run, server.pool) : null);
  /** Another device of the same account, writing straight to the server. */
  const elsewhere = (command: Omit<PracticeCommand, 'id' | 'expectedVersion' | 'runId'>) => {
    server.run = advancePractice(
      current(),
      {
        ...command,
        id: id(900 + server.version),
        expectedVersion: server.version,
        runId: server.run?.id ?? id(800),
      } as PracticeCommand,
      server.pool,
    );
    server.version++;
  };
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  await installFixtures(page);
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (server.offline) return route.abort('internetdisconnected');
      if (path === '/api/account')
        return route.fulfill(
          server.expired
            ? {
                status: 401,
                json: { error: { code: 'not_authenticated', status: 401, correlationId: 'x' } },
              }
            : { json: account },
        );
      if (path === '/api/decks')
        return route.fulfill({
          json: {
            decks: [
              {
                ...deckRow,
                path: [],
                children: [],
                noteCount: server.pool.length,
                due: 0,
                fresh: 0,
              },
            ],
          },
        });
      if (path === '/api/sync') {
        const since = Number(new URL(route.request().url()).searchParams.get('since') ?? 0);
        const changes = [
          { entity: 'decks', id: deckId, rev: 1, deleted: false, purged: false, row: deckRow },
          ...noteRows.map((row) => ({
            entity: 'notes',
            id: row.id,
            rev: 2,
            deleted: false,
            purged: false,
            row,
          })),
        ].filter((change) => change.rev > since);
        return route.fulfill({ json: { since, revision: 2, hasMore: false, changes } });
      }
      if (path === '/api/notes')
        return route.fulfill({
          json: {
            items: noteRows.filter((row) => server.pool.some((note) => note.id === row.id)),
          },
        });
      if (path === '/api/decks/practice')
        return route.fulfill({
          json: { runs: server.run ? [{ deckId, run: server.run, version: server.version }] : [] },
        });
      if (path === `/api/decks/${deckId}/practice`) {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { run: current(), version: server.version } });
        const command = route.request().postDataJSON() as PracticeCommand;
        server.posted.push(command.id);
        const receipt = server.receipts.get(command.id);
        if (receipt !== undefined)
          return receipt === JSON.stringify(command)
            ? route.fulfill({ json: { run: current(), version: server.version } })
            : route.fulfill(refused);
        if (command.expectedVersion !== server.version) return route.fulfill(refused);
        try {
          server.run = advancePractice(current(), command, server.pool);
        } catch {
          return route.fulfill(refused);
        }
        server.version++;
        server.receipts.set(command.id, JSON.stringify(command));
        server.applied.push(command);
        if (server.loseNext) {
          server.loseNext = false;
          return route.abort('connectionreset');
        }
        return route.fulfill({ json: { run: server.run, version: server.version } });
      }
      return route.fallback();
    },
  );
  await page.goto(`/notes?deckId=${deckId}`);
  await expect
    .poll(
      () =>
        page.evaluate(async (owner) => {
          // Never create the database here: the app's own first open must do that.
          const open = indexedDB.open(`neuron.collection:${owner}`);
          open.onupgradeneeded = () => open.transaction?.abort();
          const db = await new Promise<IDBDatabase | undefined>((resolve) => {
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => resolve(undefined);
          });
          if (!db) return false;
          if (!db.objectStoreNames.contains('meta')) {
            db.close();
            return false;
          }
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
  await expect(page.getByRole('button', { name: /^(Start|Resume) practice$/ })).toBeEnabled();
  const disconnect = async () => {
    server.offline = true;
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  };
  const reconnect = async () => {
    server.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  };
  return { server, elsewhere, disconnect, reconnect };
}

const reveal = (page: Page) =>
  page.getByRole('button', { name: 'Show answer', exact: true }).click();
async function classify(page: Page, known: boolean) {
  await reveal(page);
  await page.getByRole('button', { name: known ? 'Known' : 'Still learning', exact: true }).click();
}
async function startPractice(page: Page) {
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
}
const pendingSteps = async (page: Page) =>
  (await storedPractice(page, owner)).reduce((sum, record) => sum + record.pending.length, 0);

test('starts, undoes and completes Practice offline, survives a restart, and sends each step once', async ({
  page,
}) => {
  const { server, disconnect, reconnect } = await fixture(page);
  await disconnect();
  await startPractice(page);
  await expect(page.getByText('Wort 0')).toBeVisible();
  await classify(page, true);
  await expect(page.getByText('Wort 1')).toBeVisible();
  await classify(page, true);
  await expect(page.getByText('Wort 2')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect(page.getByText('Wort 1')).toBeVisible();
  await classify(page, false);
  await expect(page.getByText('Wort 2')).toBeVisible();
  expect(await pendingSteps(page)).toBe(5);

  // Leaving and reopening the app keeps every committed step; Undo is per sitting.
  await page.reload();
  await expect(page.getByText('Wort 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo last answer', exact: true })).toBeDisabled();
  await classify(page, true);
  await expect(page.getByRole('heading', { name: 'Round complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Repeat still learning', exact: true }).click();
  await expect(page.getByText('Wort 1')).toBeVisible();
  await classify(page, true);
  await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
  expect(server.posted).toEqual([]);
  const saved = (await storedPractice(page, owner))[0]!;
  expect(saved.pending.map((command) => command.kind)).toEqual([
    'start',
    'answer',
    'answer',
    'undo',
    'answer',
    'answer',
    'round',
    'answer',
  ]);

  // Reconnecting delivers in order, once each, without remounting the finished screen.
  await page.evaluate(() => {
    (document.querySelector('[data-screen]') as HTMLElement).dataset['kept'] = 'yes';
  });
  await reconnect();
  await expect.poll(() => server.applied.length, { timeout: 15_000 }).toBe(8);
  await expect.poll(() => pendingSteps(page)).toBe(0);
  expect(server.applied.map((command) => command.id)).toEqual(
    saved.pending.map((command) => command.id),
  );
  expect(new Set(server.posted).size).toBe(server.posted.length);
  await expect(page.locator('[data-screen][data-kept="yes"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
  expect(Object.values(server.run!.statuses)).toEqual(['known', 'known', 'known']);
});

test('a lost acknowledgement is retried with the same step while Practice continues', async ({
  page,
}) => {
  const { server } = await fixture(page);
  await startPractice(page);
  await expect.poll(() => pendingSteps(page)).toBe(0);
  server.loseNext = true;
  await classify(page, true);
  // The next card is there at once; the dropped answer does not hold the learner back.
  await expect(page.getByText('Wort 1')).toBeVisible();
  await classify(page, false);
  await expect(page.getByText('Wort 2')).toBeVisible();
  await expect.poll(() => server.applied.length, { timeout: 15_000 }).toBe(3);
  await expect.poll(() => pendingSteps(page), { timeout: 15_000 }).toBe(0);
  const lost = server.applied[1]!.id;
  expect(server.posted.filter((posted) => posted === lost)).toHaveLength(2);
  expect(server.applied.map((command) => command.kind)).toEqual(['start', 'answer', 'answer']);
  expect(server.run!.statuses[noteRows[1]!.id]).toBe('learning');
});

for (const keep of ['device', 'other'] as const)
  test(`two devices practicing apart ask once, and ${keep === 'device' ? 'this device' : 'the other device'} is kept`, async ({
    page,
  }) => {
    const { server, elsewhere, disconnect, reconnect } = await fixture(page);
    await startPractice(page);
    await expect.poll(() => pendingSteps(page)).toBe(0);
    await disconnect();
    await classify(page, true);
    await classify(page, true);
    await expect(page.getByText('Wort 2')).toBeVisible();
    elsewhere({ kind: 'answer', noteId: noteRows[0]!.id, known: false });
    await reconnect();
    await expect(page.getByRole('heading', { name: 'Practiced on two devices' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Round 1 · 2 / 3 known')).toBeVisible();
    await expect(page.getByText('Round 1 · 0 / 3 known')).toBeVisible();
    const versionBefore = server.version;
    if (keep === 'device') {
      await page.getByRole('button', { name: 'Continue this device’s run', exact: true }).click();
      await expect.poll(() => server.version).toBe(versionBefore + 1);
      expect(server.applied.at(-1)!.kind).toBe('replace');
      expect(server.run!.statuses[noteRows[0]!.id]).toBe('known');
      await expect(page.getByText('Wort 2')).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Continue the other run', exact: true }).click();
      await expect(page.getByText('Wort 1')).toBeVisible();
      expect(server.version).toBe(versionBefore);
      const record = (await storedPractice(page, owner))[0]!;
      expect(record.archived?.kept).toBe('other');
      expect(record.archived?.commands.map((command) => command.kind)).toEqual([
        'answer',
        'answer',
      ]);
    }
    await expect(page.getByRole('heading', { name: 'Practiced on two devices' })).toHaveCount(0);
    expect(await pendingSteps(page)).toBe(0);
  });

test('a Note deleted on another device while away does not stop delivery', async ({ page }) => {
  const { server, disconnect, reconnect } = await fixture(page);
  await startPractice(page);
  await expect.poll(() => pendingSteps(page)).toBe(0);
  await disconnect();
  await classify(page, true);
  await classify(page, false);
  server.pool = server.pool.filter((note) => note.id !== noteRows[0]!.id);
  await reconnect();
  await expect.poll(() => server.applied.length, { timeout: 15_000 }).toBe(3);
  await expect.poll(() => pendingSteps(page)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Practiced on two devices' })).toHaveCount(0);
  expect(server.run!.statuses[noteRows[0]!.id]).toBeUndefined();
  expect(server.run!.statuses[noteRows[1]!.id]).toBe('learning');
});

test('a step the device cannot save keeps the card and says so', async ({ page }) => {
  await fixture(page);
  await startPractice(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (typeof key === 'string' && key.startsWith('practice:'))
        throw new DOMException('Full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await classify(page, true);
  await expect(
    page.getByText('This answer could not be saved on this device. Try again.'),
  ).toBeVisible();
  await expect(page.getByText('Wort 0')).toBeVisible();
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(page.getByText('Wort 1')).toBeVisible();
});

test('an expired session leaves saved Practice on the device', async ({ page }) => {
  const { server, disconnect, reconnect } = await fixture(page);
  await startPractice(page);
  await expect.poll(() => pendingSteps(page)).toBe(0);
  await disconnect();
  await classify(page, true);
  // Committed: the next card only appears once the step is on the device.
  await expect(page.getByText('Wort 1')).toBeVisible();
  server.expired = true;
  await reconnect();
  await expect(page).toHaveURL(/sign-in/, { timeout: 15_000 });
  expect(server.applied).toHaveLength(1);
  const [record] = await storedPractice(page, owner);
  expect(record!.pending.map((command) => command.kind)).toEqual(['answer']);
  expect(await storedPractice(page, 'someone-else')).toEqual([]);
});

test('an offline step reaches the next card without waiting', async ({ page }) => {
  const { disconnect } = await fixture(page);
  await disconnect();
  await startPractice(page);
  const timings: number[] = [];
  for (let index = 0; index < 3; index++) {
    await reveal(page);
    timings.push(
      await page.evaluate(
        async (next) => {
          const button = [...document.querySelectorAll('button')].find(
            (item) => item.textContent === 'Known',
          )!;
          const started = performance.now();
          button.click();
          const arrived = () =>
            next === null
              ? [...document.querySelectorAll('h2')].some(
                  (heading) => heading.textContent === 'Practice complete',
                )
              : document.body.textContent?.includes(next);
          await new Promise<void>((resolve) => {
            const check = () => (arrived() ? resolve() : requestAnimationFrame(check));
            check();
          });
          return performance.now() - started;
        },
        index < 2 ? `Wort ${index + 1}` : null,
      ),
    );
  }
  // A local write, not a round trip: well inside one interaction budget on a throttled phone.
  expect(Math.max(...timings)).toBeLessThan(200);
});
