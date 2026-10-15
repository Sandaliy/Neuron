import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures, usePreferences as installPreferences } from './fixtures';
import {
  installInteractionMetrics,
  startInteractionMetrics,
  readInteractionMetrics,
  sampleInteraction,
} from './interaction-metrics';

import type { BrowserContext, CDPSession, Page, Route } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const folderId = '01900000-0000-7000-8000-000000000001';
const deckId = '01900000-0000-7000-8000-000000000002';
const noteId = '01900000-0000-7000-8000-000000000003';
const cardId = '01900000-0000-7000-8000-000000000004';
const reviewId = '01900000-0000-7000-8000-000000000005';
const date = '2026-10-10T00:00:00.000Z';
const account = {
  id: 'offline-reader',
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
  revision: 2,
};
const folder = {
  id: folderId,
  kind: 'folder',
  name: 'Downloaded Folder',
  parentId: null,
  position: 0,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
};
const deck = {
  ...folder,
  id: deckId,
  kind: 'deck',
  name: 'Downloaded Deck',
  parentId: folderId,
  rev: 1,
};
const note = {
  id: noteId,
  deckId,
  noteTypeId: '01900000-0000-7000-8000-000000000009',
  noteType: 'vocab',
  fields: { term: 'Durable word', translation: 'Downloaded meaning' },
  tags: ['cached'],
  source: null,
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: date,
  updatedAt: date,
  rev: 2,
};
const card = {
  id: cardId,
  noteId,
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
const review = {
  id: reviewId,
  cardId,
  reviewedAt: date,
  rating: 3,
  scheduledDays: 3,
  placedDue: date,
  rev: 2,
};
function change(entity: string, row: Record<string, unknown>, deleted = false, purged = false) {
  return { entity, id: row['id'], rev: row['rev'], deleted, purged, row };
}
const first = {
  since: 0,
  revision: 1,
  hasMore: true,
  changes: [change('decks', folder), change('decks', deck)],
};
const last = {
  since: 1,
  revision: 2,
  hasMore: false,
  changes: [change('notes', note), change('cards', card), change('reviews', review)],
};

async function meta(page: Page, id = account.id) {
  return page.evaluate(async (id) => {
    const request = indexedDB.open(`neuron.collection:${id}`);
    request.onupgradeneeded = () => request.transaction?.abort();
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return null;
    try {
      return await new Promise<{ cursor: number; complete: boolean } | null>((resolve) => {
        if (!db.objectStoreNames.contains('meta')) {
          resolve(null);
          return;
        }
        const read = db.transaction('meta').objectStore('meta').get('sync');
        read.onsuccess = () => resolve(read.result ?? null);
      });
    } finally {
      db.close();
    }
  }, id);
}

async function installOfflineFixtures(
  page: Page,
  context: BrowserContext,
  options: { pull?: (route: Route, since: number) => Promise<void>; who?: typeof account } = {},
) {
  await installFixtures(page);
  await page.route('**/api/account', async (route) => {
    if (!(await page.evaluate(() => navigator.onLine).catch(() => false))) {
      await route.abort('internetdisconnected');
      return;
    }
    await route.fulfill({ json: options.who ?? account });
  });
  await page.route('**/api/sync?*', async (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    if (options.pull) return options.pull(route, since);
    await route.fulfill({
      json:
        since === 0
          ? first
          : since === 1
            ? last
            : { since, revision: since, hasMore: false, changes: [] },
    });
  });
  // The real browser network switch also prevents auth/data fixtures from answering offline.
  await context.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      if (!(await page.evaluate(() => navigator.onLine).catch(() => false)))
        await route.abort('internetdisconnected');
      else await route.fallback();
    },
  );
}

async function download(page: Page) {
  await page.goto('/library');
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
}
async function offline(page: Page, context: BrowserContext) {
  // Mocked API interactions block workers. Load the built screen graph first,
  // mirroring the precached shell; actual-origin reopening is tested separately.
  if (process.env['CI']) {
    const assets = (await readdir(path.join(process.cwd(), 'dist/assets'))).filter((file) =>
      file.endsWith('.js'),
    );
    await page.evaluate(async (assets) => {
      await Promise.all(assets.map((file) => import(`/assets/${file}`)));
    }, assets);
  }
  await context.setOffline(true);
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
}

for (const [interrupted, onlineHint, stalled] of [
  [false, false, false],
  [true, false, false],
  [false, true, true],
  [false, false, true],
] as const)
  test(`a populated v2 collection upgrades on a cold offline PWA launch, interrupted=${interrupted}, onlineHint=${onlineHint}, stalled=${stalled}`, async ({
    browser,
  }, info) => {
    test.skip(!process.env['CI'], 'Requires the built application shell.');
    const shellRoot = process.env['PWA_SHELL_TEST_DIST'] ?? path.join(process.cwd(), 'dist');
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      // A reachable origin can leave API requests suspended indefinitely.
      if (pathname.startsWith('/api/')) return;
      if (pathname === '/seed') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><body>Prior collection storage</body></html>');
        return;
      }
      const asset =
        pathname.startsWith('/assets/') ||
        ['/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(
          pathname,
        )
          ? pathname.slice(1)
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
                  : 'text/html',
        );
        response.end(await readFile(path.join(shellRoot, asset)));
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing origin');
    const origin = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({
      serviceWorkers: 'allow',
      baseURL: origin,
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    let page = await context.newPage();
    const renameId = '01900000-0000-7000-8000-000000000081';
    const editId = '01900000-0000-7000-8000-000000000082';
    const rename = {
      operationId: renameId,
      accountId: account.id,
      entityId: deck.id,
      state: 'pending',
      payload: {
        operationId: renameId,
        accountId: account.id,
        baseRev: deck.rev,
        name: 'Saved offline deck',
      },
      base: change('decks', deck),
    };
    const fields = { ...note.fields, term: 'Saved offline word' };
    const edit = {
      kind: 'note-edit',
      operationId: editId,
      accountId: account.id,
      entityId: note.id,
      state: 'pending',
      sequence: 2,
      started: true,
      payload: {
        operationId: editId,
        accountId: account.id,
        baseRev: note.rev,
        fields,
        tags: note.tags,
      },
      working: { fields, tags: note.tags },
      base: change('notes', note),
    };
    const archived = {
      ...edit,
      operationId: '01900000-0000-7000-8000-000000000083',
      state: 'resolved',
      sequence: 1,
      payload: { ...edit.payload, operationId: '01900000-0000-7000-8000-000000000083' },
      working: { fields: note.fields, tags: note.tags },
    };
    const fingerprint = (page: Page) =>
      page.evaluate(async (accountId) => {
        const opened = indexedDB.open(`neuron.collection:${accountId}`);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          opened.onsuccess = () => resolve(opened.result);
          opened.onerror = () => reject(opened.error);
        });
        try {
          const stores = Array.from(db.objectStoreNames).filter((name) => name !== 'review-outbox');
          const values = await Promise.all(
            stores.map(
              (name) =>
                new Promise((resolve, reject) => {
                  const store = db.transaction(name).objectStore(name);
                  const keys = store.getAllKeys();
                  const rows = store.getAll();
                  rows.onsuccess = () => resolve({ name, keys: keys.result, rows: rows.result });
                  rows.onerror = () => reject(rows.error);
                }),
            ),
          );
          return { version: db.version, values };
        } finally {
          db.close();
        }
      }, account.id);
    try {
      await page.goto('/seed');
      await page.evaluate(
        async ({ account, rows, pending, interrupted }) => {
          const opened = indexedDB.open(`neuron.collection:${account.id}`, 2);
          opened.onupgradeneeded = () => {
            const db = opened.result;
            db.createObjectStore('meta');
            db.createObjectStore('outbox', { keyPath: 'operationId' });
            for (const entity of [
              'decks',
              'notes',
              'cards',
              'reviews',
              'studyPresets',
              'importBatches',
            ]) {
              const store = db.createObjectStore(entity, { keyPath: 'id' });
              store.createIndex('rev', 'rev');
              if (entity === 'notes' || entity === 'cards')
                store.createIndex('deckId', 'row.deckId');
              if (entity === 'cards' || entity === 'reviews')
                store.createIndex('noteOrCardId', entity === 'cards' ? 'row.noteId' : 'row.cardId');
            }
          };
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            opened.onsuccess = () => resolve(opened.result);
            opened.onerror = () => reject(opened.error);
          });
          const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite');
          tx.objectStore('meta').put(account, 'account');
          tx.objectStore('meta').put(
            { cursor: 2, complete: true, format: 1, outboxVersion: 2 },
            'sync',
          );
          tx.objectStore('meta').put(2, 'note-sequence');
          for (const row of rows) tx.objectStore(row.entity).put(row);
          for (const entry of pending) tx.objectStore('outbox').put(entry);
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          db.close();
          localStorage.setItem('neuron.offline.account', account.id);
          if (interrupted) localStorage.setItem('interrupt-upgrade', 'true');
          await navigator.serviceWorker.register('/sw.js');
          await navigator.serviceWorker.ready;
        },
        {
          account,
          rows: [...first.changes, ...last.changes],
          pending: [rename, edit, archived],
          interrupted,
        },
      );
      const before = await fingerprint(page);
      expect(before.version).toBe(2);
      await context.addInitScript((onlineHint) => {
        Object.defineProperty(Navigator.prototype, 'onLine', {
          configurable: true,
          get: () => onlineHint,
        });
        const original = IDBDatabase.prototype.createObjectStore;
        IDBDatabase.prototype.createObjectStore = function (name, options) {
          const store = original.call(this, name, options);
          if (name === 'review-outbox' && localStorage.getItem('interrupt-upgrade') === 'true')
            store.transaction.abort();
          return store;
        };
      }, onlineHint);
      if (!stalled)
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      await page.close();
      page = await context.newPage();
      const startup = Date.now();
      await page.goto('/library');
      if (interrupted) {
        await expect(page.getByText(/offline storage could not be opened or read/)).toBeVisible();
        expect(await fingerprint(page)).toEqual(before);
        await page.evaluate(() => localStorage.removeItem('interrupt-upgrade'));
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
      }
      await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
      const startupMs = Date.now() - startup;
      if (!interrupted) expect(startupMs).toBeLessThan(3000);
      await info.attach('cold-pwa-startup', {
        body: JSON.stringify({ interrupted, onlineHint, stalled, startupMs }),
        contentType: 'application/json',
      });
      await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
      await expect(page.getByRole('button', { name: /^Saved offline deck/ })).toBeVisible();
      const after = await fingerprint(page);
      expect(after.version).toBe(3);
      expect(after.values).toEqual(before.values);
      await page.goto(`/notes/${note.id}`);
      await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue(
        'Saved offline word',
      );
      await page.close();
      page = await context.newPage();
      await page.goto('/library');
      await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
      expect((await fingerprint(page)).values).toEqual(before.values);
    } finally {
      await context.close();
      server.close();
      server.closeAllConnections();
    }
  });

test('repeated foreground and offline events cannot invalidate interrupted account restoration', async ({
  page,
  context,
}, info) => {
  await installOfflineFixtures(page, context);
  await download(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) {
      const request = original.apply(this, args);
      Object.defineProperty(request, 'onsuccess', {
        set(callback: (event: Event) => void) {
          request.addEventListener('success', (event) =>
            setTimeout(() => callback.call(request, event), 120),
          );
        },
      });
      return request;
    };
    let count = 0;
    const events = setInterval(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      if (++count === 100) clearInterval(events);
    }, 30);
  });
  const start = Date.now();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
  const startup = Date.now() - start;
  expect(startup).toBeLessThan(3000);
  await info.attach('restoration-events', {
    body: JSON.stringify({ startup }),
    contentType: 'application/json',
  });
  expect(await meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
});

test('foreground stalled HTTP hands a mounted Deck to local reads without a pending account request', async ({
  page,
  context,
}, info) => {
  await installContinuityFixtures(page, context);
  await download(page);
  await page.goto(`/notes?deckId=${deckId}`);
  const practice = page.getByRole('button', { name: 'Start practice', exact: true });
  await expect(practice).toBeEnabled();
  await page
    .locator('main section[data-screen]')
    .evaluate((element) => element.setAttribute('data-visit', 'foreground'));
  await page.route('**/api/**', () => undefined);
  const start = Date.now();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(
    page.getByRole('button', { name: 'Practice requires a connection.', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }),
  ).toBeVisible();
  const handover = Date.now() - start;
  expect(handover).toBeLessThan(5000);
  await expect(page.locator('[data-visit="foreground"]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  await info.attach('foreground-handover', {
    body: JSON.stringify({ handover }),
    contentType: 'application/json',
  });
});

test('cached navigation detects stalled HTTP without a connectivity or foreground event', async ({
  page,
  context,
}, info) => {
  await installContinuityFixtures(page, context);
  await download(page);
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
  // Warm every destination before the loss. No data GET is needed on return.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.route('**/api/**', () => undefined);
  const at = Date.now();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
  const handover = Date.now() - at;
  expect(handover).toBeLessThan(5000);
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
  await info.attach('cached-navigation-handover', {
    body: JSON.stringify({ handover }),
    contentType: 'application/json',
  });
});

test('a false offline hint cannot overrule a freshly accepted server session', async ({
  page,
  context,
}) => {
  await installContinuityFixtures(page, context);
  await download(page);
  await page.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Offline · collection reading', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New deck', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  let created = false;
  await page.route('**/api/decks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    created = true;
    return route.fulfill({ json: { deck: { ...deck, ...route.request().postDataJSON() } } });
  });
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Connection checked');
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => created).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('repeated foreground events with a false offline hint join one accepted validation', async ({
  page,
  context,
}) => {
  await installContinuityFixtures(page, context);
  await download(page);
  let probes = 0;
  await page.route('**/api/account', async (route) => {
    probes++;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: account });
  });
  await page.evaluate(async () => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
    for (let at = 0; at < 8; at++) {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  await expect(page.getByText('Offline · collection reading', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New deck', exact: true })).toBeEnabled();
  expect(probes).toBe(1);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
});

test('startup diagnostics retain a failed launch after recovery without content or identifiers', async ({
  page,
}) => {
  await installFixtures(page);
  // Fail the real entry module after the shell has recorded startup. Recovery
  // must retain that launch even though React never mounted its export control.
  const entryModule = /\/(?:assets\/index-[^/?]+\.js|src\/main\.tsx)(?:\?.*)?$/;
  await page.route(entryModule, (route) => route.abort('failed'));
  await page.goto('/settings');
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('neuron.lifecycle') ?? '[]').some(
          (row: { stage: string }) => row.stage === 'script-error',
        ),
      ),
    )
    .toBe(true);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  const initial = await page.evaluate(() => {
    const lifecycle = (window as Window & { neuronLifecycle: (stage: string) => void })
      .neuronLifecycle;
    for (let at = 0; at < 120; at++) lifecycle('foreground');
    return JSON.parse(localStorage.getItem('neuron.lifecycle')!) as Array<{
      at: number;
      stage: string;
    }>;
  });
  const failed = initial.find((row) => row.stage === 'script-error')!;
  expect(failed).toBeDefined();
  await page.unroute(entryModule);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save startup diagnostics', exact: true }).click();
  const artifact = await download;
  const stream = (await artifact.createReadStream())!;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const rows = JSON.parse(Buffer.concat(chunks).toString()) as Array<Record<string, unknown>>;
  expect(rows.some((row) => row['stage'] === 'script-error' && row['at'] === failed.at)).toBe(true);
  expect(rows.length).toBeLessThanOrEqual(120);
  expect(rows.every((row) => Object.keys(row).sort().join(',') === 'at,elapsed,online,stage')).toBe(
    true,
  );
});

test('a lost connection restores the downloaded account while its startup validation is suspended', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  let started = false;
  let release!: () => void;
  const suspended = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/account', async (route) => {
    started = true;
    await suspended;
    await route.abort('internetdisconnected').catch(() => undefined);
  });
  try {
    await page.reload();
    await expect.poll(() => started).toBe(true);
    await offline(page, context);
    await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
    expect(await meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  } finally {
    release();
  }
});

test.describe('reconciliation measurements', () => {
  test('stabilization continuity during downloaded Deck reconciliation', async ({
    page,
    context,
    browserName,
  }, info) => {
    test.setTimeout(180000);
    await installInteractionMetrics(page);
    await installPreferences(page, { locale: 'en', theme: 'dark', glass: 'full', motion: 'full' });
    const size = browserName === 'webkit' ? 1000 : 5000;
    let refreshed = false;
    let rows = Array.from({ length: size }, (_, at) => ({
      ...note,
      id: `01900000-0000-7000-8000-${String(at + 100).padStart(12, '0')}`,
      rev: at * 2 + 2,
      fields: { term: `Stable word ${String(at).padStart(4, '0')}`, translation: 'Stored meaning' },
    }));
    await installOfflineFixtures(page, context, {
      pull: async (route, since) => {
        await route.fulfill({
          json:
            since === 0
              ? { ...first, changes: [change('decks', { ...deck, parentId: null })] }
              : since === 1
                ? last
                : refreshed && since === size * 2 + 1
                  ? {
                      since,
                      revision: since + 1,
                      hasMore: false,
                      changes: [change('notes', { ...rows[0], rev: since + 1 })],
                    }
                  : { since, revision: since, hasMore: false, changes: [] },
        });
      },
    });
    await page.route('**/api/decks', (route) =>
      route.fulfill({
        json: {
          decks: [
            { ...deck, parentId: null, path: [], children: [], noteCount: size, due: 0, fresh: 0 },
          ],
        },
      }),
    );
    await page.route(`**/api/decks/${deckId}/practice`, (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.goto('/settings');
    await expect(
      page.getByText('Collection downloaded for offline reading.', { exact: true }),
    ).toBeVisible();
    // Isolate browsing a previously completed download. Paginated hydration, atomic
    // cursor application and interrupted downloads have separate regressions below.
    await page.evaluate(
      async ({ id, note, card, size }) => {
        const opened = indexedDB.open(`neuron.collection:${id}`);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          opened.onsuccess = () => resolve(opened.result);
          opened.onerror = () => reject(opened.error);
        });
        try {
          for (let offset = 0; offset < size; offset += 200)
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction(['notes', 'cards', 'meta'], 'readwrite');
              if (offset === 0) {
                tx.objectStore('notes').clear();
                tx.objectStore('cards').clear();
              }
              for (let at = offset; at < offset + 200; at++) {
                const row = {
                  ...note,
                  id: `01900000-0000-7000-8000-${String(at + 100).padStart(12, '0')}`,
                  rev: at * 2 + 2,
                  fields: {
                    term: `Stable word ${String(at).padStart(4, '0')}`,
                    translation: 'Stored meaning',
                  },
                };
                const direction = {
                  ...card,
                  id: `01900000-0000-7000-8000-${String(at + 10000).padStart(12, '0')}`,
                  noteId: row.id,
                  rev: row.rev + 1,
                };
                tx.objectStore('notes').put({
                  entity: 'notes',
                  id: row.id,
                  rev: row.rev,
                  deleted: false,
                  purged: false,
                  row,
                });
                tx.objectStore('cards').put({
                  entity: 'cards',
                  id: direction.id,
                  rev: direction.rev,
                  deleted: false,
                  purged: false,
                  row: direction,
                });
              }
              if (offset + 200 === size)
                tx.objectStore('meta').put(
                  { cursor: size * 2 + 1, complete: true, format: 1 },
                  'sync',
                );
              tx.oncomplete = () => resolve();
              tx.onabort = () => reject(tx.error);
            });
        } finally {
          db.close();
        }
      },
      { id: account.id, note, card, size },
    );
    await page.reload();
    await expect(
      page.getByText('Collection downloaded for offline reading.', { exact: true }),
    ).toBeVisible();
    let profiler: CDPSession | undefined;
    if (browserName === 'chromium') {
      const cpu = await context.newCDPSession(page);
      await cpu.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      if (process.env['STABILIZATION_PROFILE'] === 'true') {
        profiler = cpu;
        await profiler.send('Profiler.enable');
        await profiler.send('Profiler.start');
      }
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '47px'));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/notes?*', async (route) => {
      await held;
      const offset = Number(
        new URL(route.request().url()).searchParams.get('cursor')?.split(':')[1] ?? 0,
      );
      await route.fulfill({
        json: {
          items: rows.slice(offset, offset + 1000),
          ...(offset + 1000 < rows.length ? { nextCursor: `server:${offset + 1000}` } : {}),
        },
      });
    });
    await startInteractionMetrics(page);
    const libraryStart = performance.now();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Downloaded Deck/ })).toBeVisible();
    const libraryMs = performance.now() - libraryStart;
    const start = performance.now();
    await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
    const firstRow = page.getByRole('button', { name: /Stable word 0000/ });
    await expect(firstRow).toBeVisible();
    const firstContentMs = performance.now() - start;
    await page.locator('[data-screen]').evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const geometry = () =>
      page.evaluate(() => ({
        heading: document.querySelector('h1')!.getBoundingClientRect().top,
        search: document.querySelector('input[type="search"]')!.getBoundingClientRect().top,
        list: document.querySelector('[data-rows]')!.getBoundingClientRect().top,
        practice: Array.from(document.querySelectorAll('h2')).some(
          (node) => node.textContent === 'Practice',
        ),
      }));
    const before = await geometry();
    await firstRow.evaluate((element) => {
      Object.assign(window, {
        originalRow: element,
        originalScreen: document.querySelector('[data-screen]'),
      });
    });
    const baseline = process.env['STABILIZATION_BASELINE'] === 'true';
    if (!baseline) {
      await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Start practice', exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText(
          /Browse downloaded Folders, Decks and Notes, rename existing collections, and edit existing Notes/,
        ),
      ).toHaveCount(0);
    }
    const authorityStart = performance.now();
    release();
    await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
    const authoritativeActionsMs = performance.now() - start;
    const reconciliationMs = performance.now() - authorityStart;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const after = await geometry();
    const retained = await page.evaluate(() => {
      const previous = window as unknown as {
        originalRow: HTMLElement;
        originalScreen: HTMLElement;
      };
      return {
        row: previous.originalRow.isConnected,
        screen: previous.originalScreen === document.querySelector('[data-screen]'),
      };
    });
    const metrics = await readInteractionMetrics(page);
    if (profiler) {
      const { profile } = await profiler.send('Profiler.stop');
      await info.attach('reconciliation.cpuprofile', {
        body: JSON.stringify(profile),
        contentType: 'application/json',
      });
    }
    const evidence = {
      browser: browserName,
      notes: size,
      cards: size,
      cpu: browserName === 'chromium' ? 4 : 'native WebKit',
      baseline,
      libraryMs,
      firstContentMs,
      stableLayoutMs: baseline ? authoritativeActionsMs : firstContentMs,
      authoritativeActionsMs,
      reconciliationMs,
      before,
      after,
      retained,
      ...metrics,
    };
    await info.attach('stabilization-evidence', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    if (!baseline) {
      expect(before.practice).toBe(true);
      expect(after.list).toBeCloseTo(before.list, 0);
      expect(after.search).toBeCloseTo(before.search, 0);
      expect(before.heading).toBeGreaterThanOrEqual(
        info.project.name === 'desktop-interaction' ? 24 : 47,
      );
      expect(retained).toEqual({ row: true, screen: true });
    } else {
      expect(before.practice).toBe(false);
      expect(Math.abs(after.list - before.list)).toBeGreaterThan(40);
    }
    const stages: Record<string, unknown> = {};
    stages.warmLibrary = await sampleInteraction(page, () =>
      page.getByRole('link', { name: 'Library', exact: true }).click(),
    );
    const warmStart = performance.now();
    stages.warmDeck = await sampleInteraction(page, async () => {
      await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
      await expect(firstRow).toBeVisible();
      stages.warmContentMs = performance.now() - warmStart;
    });
    stages.swipe = await sampleInteraction(page, async () => {
      await firstRow.dispatchEvent('pointerdown', {
        pointerType: 'touch',
        clientX: 300,
        clientY: 650,
      });
      await firstRow.dispatchEvent('pointermove', {
        pointerType: 'touch',
        clientX: 240,
        clientY: 650,
      });
      await firstRow.dispatchEvent('pointerup', {
        pointerType: 'touch',
        clientX: 240,
        clientY: 650,
      });
    });
    await expect(page.locator('[data-swipe-action]:visible')).toBeVisible();
    await firstRow.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      clientX: 300,
      clientY: 650,
    });
    await firstRow.dispatchEvent('pointermove', {
      pointerType: 'touch',
      clientX: 380,
      clientY: 650,
    });
    await firstRow.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 380, clientY: 650 });
    await expect(page.locator('[data-swipe-action]:visible')).toHaveCount(0);
    await page.route(`**/api/notes/${rows[0]!.id}`, async (route) => {
      rows = rows.slice(1);
      await route.fulfill({ json: { deleted: true } });
    });
    stages.swipeDelete = await sampleInteraction(page, async () => {
      await firstRow.dispatchEvent('pointerdown', {
        pointerType: 'touch',
        clientX: 300,
        clientY: 650,
      });
      await firstRow.dispatchEvent('pointermove', {
        pointerType: 'touch',
        clientX: 40,
        clientY: 650,
      });
      await firstRow.dispatchEvent('pointerup', {
        pointerType: 'touch',
        clientX: 40,
        clientY: 650,
      });
    });
    await expect(firstRow).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Stable word 0001/ })).toBeVisible();
    stages.todayNavigation = await sampleInteraction(page, () =>
      page.getByRole('link', { name: 'Today', exact: true }).click(),
    );
    const setup = page.getByRole('button', { name: 'Study setup', exact: true });
    await expect(setup).toBeVisible();
    stages.disclosureOpen = await sampleInteraction(page, () => setup.click());
    await expect(setup).toHaveAttribute('aria-expanded', 'true');
    stages.disclosureClose = await sampleInteraction(page, () => setup.click());
    await expect(setup).toHaveAttribute('aria-expanded', 'false');
    stages.settingsNavigation = await sampleInteraction(page, () =>
      page.getByRole('link', { name: 'Settings', exact: true }).click(),
    );
    stages.securityOpen = await sampleInteraction(page, () =>
      page.getByRole('button', { name: 'Change your password', exact: true }).click(),
    );
    await expect(page.getByRole('dialog')).toBeVisible();
    stages.securityClose = await sampleInteraction(page, () => page.keyboard.press('Escape'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Age query freshness without replacing native animation-frame scheduling.
    await page.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 360_001;
    });
    refreshed = true;
    stages.backgroundRefreshNavigationAndSetup = await sampleInteraction(page, async () => {
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await expect
        .poll(() => meta(page))
        .toEqual({ cursor: size * 2 + 2, complete: true, format: 1 });
      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await page.getByRole('link', { name: 'Today', exact: true }).click();
      await setup.click();
      await expect(setup).toHaveAttribute('aria-expanded', 'true');
    });
    if (!baseline) {
      const refresh = stages.backgroundRefreshNavigationAndSetup as {
        scans: Record<string, number>;
      };
      expect(refresh.scans['notes'] ?? 0).toBe(0);
      expect(refresh.scans['cards'] ?? 0).toBe(0);
    }
    if (!baseline) {
      const cover = await page.locator('[data-safe-area-cover]').boundingBox();
      expect(cover!.y).toBe(0);
      expect(cover!.height).toBe(47);
      await page.evaluate(() => window.scrollTo(0, 150));
      expect((await page.locator('[data-safe-area-cover]').boundingBox())!.y).toBe(0);
    }
    await info.attach('stabilization-interactions', {
      body: JSON.stringify(stages, null, 2),
      contentType: 'application/json',
    });
  });
});

test('direct Practice entry never turns provisional browse rows into an authoritative pool', async ({
  page,
  context,
}) => {
  await installContinuityFixtures(page, context);
  await download(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let poolReads = 0;
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes++;
  });
  await page.route('**/api/notes?*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('sort')) poolReads++;
    await held;
    await route.fulfill({ json: { items: [note] } }).catch(() => undefined);
  });
  await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /^Nested Folder/ }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await expect(page.getByRole('button', { name: /Durable word/ })).toBeVisible();
  await page.evaluate((deckId) => {
    history.pushState(
      { ...history.state, __TSR_index: (history.state?.__TSR_index ?? 0) + 1 },
      '',
      `/notes?deckId=${deckId}&learning=practice`,
    );
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, deckId);
  await expect.poll(() => poolReads).toBe(1);
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
  release();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
  expect(writes).toBe(0);
});

test('a delayed saved Practice summary retains the entry, search and Note positions', async ({
  page,
  context,
}) => {
  await installContinuityFixtures(page, context);
  await download(page);
  let held: Route | undefined;
  await page.route(`**/api/decks/${deckId}/practice`, (route) => {
    held = route;
  });
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(page.getByRole('button', { name: /Durable word/ })).toBeVisible();
  const action = page.getByRole('button', { name: 'Start practice', exact: true });
  await expect(action).toBeDisabled();
  const positions = () =>
    page.evaluate(() => ({
      search: document.querySelector('input[type="search"]')!.getBoundingClientRect().top,
      list: document.querySelector('[data-rows]')!.getBoundingClientRect().top,
    }));
  const before = await positions();
  await action.evaluate((element) => Object.assign(window, { originalPracticeAction: element }));
  await expect.poll(() => Boolean(held)).toBe(true);
  await held!.fulfill({
    json: {
      version: 1,
      run: {
        id: reviewId,
        front: 'term',
        back: 'translation',
        response: 'reveal',
        statuses: { [noteId]: 'known' },
        queue: [],
        round: 1,
      },
    },
  });
  await expect(page.getByRole('button', { name: 'Resume practice', exact: true })).toBeEnabled();
  expect(await positions()).toEqual(before);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { originalPracticeAction: HTMLElement }).originalPracticeAction
          .isConnected,
    ),
  ).toBe(true);
});

test('interrupted provisional Deck entry retries authority on return without reopening the app', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await page.route('**/api/decks', (route) =>
    route.fulfill({
      json: {
        decks: [
          { ...deck, parentId: null, path: [], children: [], noteCount: 1, due: 0, fresh: 0 },
        ],
      },
    }),
  );
  await page.route(`**/api/decks/${deckId}/practice`, (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  await download(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route('**/api/notes?*', async (route) => {
    reads++;
    await held;
    await route.fulfill({ json: { items: [note] } }).catch(() => undefined);
  });
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await expect(page.getByRole('button', { name: /Durable word/ })).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await expect(page.getByRole('button', { name: /Durable word/ })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
  expect(reads).toBeGreaterThan(1);
});

for (const mode of ['fast', 'delayed', 'unavailable', 'interrupted'] as const) {
  test(`downloaded collection latency: ${mode}, first and warm entry, 5,000 Notes`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180000);
    const rows = Array.from({ length: 5000 }, (_, at) => ({
      ...note,
      id: `01900000-0000-7000-8000-${String(at + 100).padStart(12, '0')}`,
      rev: at + 2,
      fields: {
        term: `Latency word ${String(at).padStart(4, '0')}`,
        translation: 'Stored meaning',
      },
    }));
    await installOfflineFixtures(page, context, {
      pull: async (route, since) => {
        const pageRows = rows.filter((row) => row.rev > since).slice(0, 200);
        const revision = pageRows.at(-1)?.rev ?? since;
        await route.fulfill({
          json: {
            since,
            revision,
            hasMore: revision < 5001,
            changes: [
              ...(since === 0 ? [change('decks', folder), change('decks', deck)] : []),
              ...pageRows.map((row) => change('notes', row)),
            ],
          },
        });
      },
    });
    await page.route('**/api/decks', (route) =>
      route.fulfill({
        json: {
          decks: [
            {
              ...folder,
              path: [],
              due: 0,
              fresh: 0,
              noteCount: 5000,
              children: [
                { ...deck, path: [folderId], due: 0, fresh: 0, noteCount: 5000, children: [] },
              ],
            },
          ],
        },
      }),
    );
    await page.goto('/settings');
    await expect(
      page.getByText('Collection downloaded for offline reading.', { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await page.evaluate(() => {
      const scans: Record<string, number> = {};
      Object.assign(window, { collectionScans: scans });
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (['decks', 'notes', 'cards'].includes(this.name))
          scans[this.name] = (scans[this.name] ?? 0) + 1;
        return getAll.apply(this, args);
      };
    });
    let answered = false;
    await page.route('**/api/notes?*', async (route) => {
      if (mode !== 'fast')
        await new Promise((resolve) => setTimeout(resolve, mode === 'delayed' ? 1800 : 2500));
      if (mode === 'unavailable' || mode === 'interrupted')
        await route.abort('internetdisconnected');
      else await route.fulfill({ json: { items: rows } });
      answered = true;
    });
    if (mode === 'unavailable' || mode === 'interrupted')
      await page.route('**/api/account', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.abort('internetdisconnected');
      });
    // Navigate within the authenticated visit; do not measure a new account bootstrap.
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
    const start = performance.now();
    await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
    if (mode === 'interrupted') await context.setOffline(true);
    await expect(page.getByRole('button', { name: /Latency word 0000/ })).toBeVisible({
      timeout: 15000,
    });
    const cold = performance.now() - start;
    if (mode === 'delayed' || mode === 'unavailable') expect(answered).toBe(false);
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
    const warmStart = performance.now();
    await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
    await expect(page.getByRole('button', { name: /Latency word 0000/ })).toBeVisible();
    const warm = performance.now() - warmStart;
    const scans = await page.evaluate(
      () => (window as unknown as { collectionScans: Record<string, number> }).collectionScans,
    );
    expect(scans['notes'] ?? 0).toBeLessThanOrEqual(1);
    expect(scans['decks'] ?? 0).toBeLessThanOrEqual(1);
    expect(scans['cards'] ?? 0).toBeLessThanOrEqual(1);
    await info.attach('collection-latency', {
      body: JSON.stringify({ mode, cold, warm, scans }),
      contentType: 'application/json',
    });
  });
}

test('complete download, offline folders/decks/notes/editing and server-only route boundaries', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  await offline(page, context);
  await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await page.getByRole('button', { name: /Durable word/ }).click();
  const translation = page.getByRole('textbox', { name: 'Translation' });
  await expect(translation).toHaveValue('Downloaded meaning');
  await translation.fill('Edited offline meaning');
  await expect(page.getByText('Saved on device', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('main header time')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start Study|Start Practice/ })).toHaveCount(0);
  await page.evaluate(() => history.pushState({}, '', '/import'));
  await page.goBack();
});

test('offline PWA shell reload and reopening retain collection; API responses are never cached', async ({
  browser,
}) => {
  test.skip(!process.env['CI'], 'Application-shell tests require the built preview server.');
  // A real disposable origin avoids worker-owned fixture interception and the WebKit
  // offline-emulation navigation failure. Shutting it down removes the actual network.
  let updatedWorker = false;
  const priorBuild = process.env['PWA_PRIOR_BUILD'];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      const since = Number(url.searchParams.get('since'));
      const body =
        url.pathname === '/api/account'
          ? account
          : url.pathname === '/api/sync'
            ? since === 0
              ? first
              : since === 1
                ? last
                : { since, revision: since, hasMore: false, changes: [] }
            : url.pathname === '/api/decks'
              ? {
                  decks: [
                    {
                      ...folder,
                      path: [],
                      due: 0,
                      fresh: 0,
                      noteCount: 1,
                      children: [
                        { ...deck, path: [folderId], due: 0, fresh: 0, noteCount: 1, children: [] },
                      ],
                    },
                  ],
                }
              : {};
      response.end(JSON.stringify(body));
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
      const content = await readFile(
        path.join(
          priorBuild && !updatedWorker ? priorBuild : path.join(process.cwd(), 'dist'),
          asset,
        ),
      );
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
      response.end(
        asset === 'sw.js' && updatedWorker && !priorBuild
          ? content
              .toString()
              .replace(/const VERSION = [^;]+;/, 'const VERSION = "waiting-test-version";')
          : content,
      );
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test origin');
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    baseURL: origin,
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  let page = await context.newPage();
  try {
    await download(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    if (priorBuild)
      expect(
        await page.evaluate(async () => {
          const opened = indexedDB.open('neuron.collection:offline-reader');
          const db = await new Promise<IDBDatabase>((resolve) => {
            opened.onsuccess = () => resolve(opened.result);
          });
          const version = db.version;
          db.close();
          return version;
        }),
      ).toBe(2);
    updatedWorker = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return registration.waiting?.state;
        }),
      )
      .toBe('installed');
    const activeVersion = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const channel = new MessageChannel();
      const version = new Promise<string>((resolve) => {
        channel.port1.onmessage = (event) => {
          resolve(event.data as string);
          channel.port1.close();
        };
      });
      registration.active?.postMessage('shell-version', [channel.port2]);
      return version;
    });
    expect(activeVersion).not.toBe('waiting-test-version');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByText(/Close all Neuron windows/)).toBeVisible();
    if (priorBuild) {
      await page.close();
      // The waiting shell is already cached. Its first launch and database
      // upgrade must work after the actual HTTP origin has disappeared.
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      page = await context.newPage();
      await download(page);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const opened = indexedDB.open('neuron.collection:offline-reader');
            const db = await new Promise<IDBDatabase>((resolve) => {
              opened.onsuccess = () => resolve(opened.result);
            });
            const version = db.version;
            db.close();
            return version;
          }),
        )
        .toBe(3);
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await page.reload();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/library`);
    await expect(reopened.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
    const cached = await reopened.evaluate(async () =>
      (
        await Promise.all(
          (await caches.keys()).map(async (name) =>
            (await (await caches.open(name)).keys()).map(
              (request) => new URL(request.url).pathname,
            ),
          ),
        )
      ).flat(),
    );
    expect(cached).toContain('/index.html');
    expect(cached).toContain('/manifest.webmanifest');
    expect(cached.some((path) => path.startsWith('/api'))).toBe(false);
  } finally {
    await context.close();
    server.close();
  }
});

test('interrupted initial download stays hidden and resumes at the committed boundary', async ({
  page,
  context,
}) => {
  let interrupted = true;
  const cursors: number[] = [];
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      cursors.push(since);
      if (since === 1 && interrupted) {
        await route.abort('internetdisconnected');
        return;
      }
      await route.fulfill({ json: since === 0 ? first : last });
    },
  });
  await page.goto('/library');
  await expect.poll(() => meta(page)).toEqual({ cursor: 1, complete: false, format: 1 });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('You can keep using Neuron online.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toHaveCount(0);
  interrupted = false;
  await page.reload();
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  expect(cursors).toEqual([0, 1, 1]);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await offline(page, context);
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
});

test('transaction abort rolls back entities and cursor; retry applies the complete page', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'cards' && !sessionStorage.getItem('aborted-page')) {
        sessionStorage.setItem('aborted-page', 'true');
        this.transaction.abort();
        throw new DOMException('Injected interruption', 'AbortError');
      }
      return original.apply(this, args);
    };
  });
  await installOfflineFixtures(page, context);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  expect(await meta(page)).toEqual({ cursor: 1, complete: false, format: 1 });
  const count = await page.evaluate(async () => {
    const opened = indexedDB.open('neuron.collection:offline-reader');
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const request = db.transaction('notes').objectStore('notes').count();
    const count = await new Promise<number>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return count;
  });
  expect(count).toBe(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
});

test('reconnect validates session and pulls incremental changes including tombstones', async ({
  page,
  context,
}) => {
  const cursors: number[] = [];
  let changed = false;
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      cursors.push(since);
      await route.fulfill({
        json:
          since === 0
            ? first
            : since === 1
              ? last
              : changed
                ? {
                    since,
                    revision: 3,
                    hasMore: false,
                    changes: [change('notes', { ...note, rev: 3 }, true, true)],
                  }
                : { since, revision: since, hasMore: false, changes: [] },
      });
    },
  });
  await download(page);
  await offline(page, context);
  changed = true;
  await context.setOffline(false);
  await expect.poll(() => meta(page)).toEqual({ cursor: 3, complete: true, format: 1 });
  expect(cursors).toContain(2);
  await offline(page, context);
  await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await expect(page.getByText('No items here.', { exact: true })).toBeVisible();
});

test('explicit offline sign-out revokes remembered access and account switching isolates collections', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  // Keep shell assets reachable in this worker-blocked fixture. WebKit offline
  // emulation poisons lazy auth imports; real cached-shell navigation is tested separately.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => route.abort('internetdisconnected'),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  expect(await page.evaluate(() => localStorage.getItem('neuron.offline.account'))).toBeNull();
  await installOfflineFixtures(page, context, {
    who: { ...account, id: 'other-reader' },
    pull: async (route, since) => {
      await route.fulfill({ json: { since, revision: 0, hasMore: false, changes: [] } });
    },
  });
  await page.goto('/library');
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel('Email', { exact: true }).fill('reader@example.test');
  await page.getByLabel('Password', { exact: true }).fill('a-strong-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect
    .poll(() => meta(page, 'other-reader'))
    .toEqual({ cursor: 0, complete: true, format: 1 });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await offline(page, context);
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toHaveCount(0);
  await expect(page.getByText('No items here.', { exact: true })).toBeVisible();
});

test('sign-out while a pull is in flight cannot advance or re-enable the old account', async ({
  page,
  context,
}) => {
  let release!: () => void;
  const delivery = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = false;
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      if (since === 0) return route.fulfill({ json: first });
      pending = true;
      await delivery;
      await route.fulfill({ json: last }).catch(() => undefined);
    },
  });
  try {
    await page.goto('/sign-in');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await page.goto('/library');
    await expect.poll(() => meta(page)).toEqual({ cursor: 1, complete: false, format: 1 });
    await expect.poll(() => pending).toBe(true);
    await offline(page, context);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/sign-in/);
    release();
    expect(await meta(page)).toEqual({ cursor: 1, complete: false, format: 1 });
    expect(await page.evaluate(() => localStorage.getItem('neuron.offline.account'))).toBeNull();
    await context.setOffline(false);
    await page.goto('/library');
    await expect(page).toHaveURL(/sign-in/);
  } finally {
    release();
  }
});

test('two tabs deliver duplicate pages without losing entities or regressing the durable cursor', async ({
  page,
  context,
}) => {
  let pending: Route | undefined;
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      if (since === 0) {
        pending = route;
        return;
      }
      await route.fulfill({
        json: since === 1 ? last : { since, revision: since, hasMore: false, changes: [] },
      });
    },
  });
  await page.goto('/library');
  await expect.poll(() => Boolean(pending)).toBe(true);
  const second = await context.newPage();
  await installOfflineFixtures(second, context);
  await download(second);
  await pending!.fulfill({ json: first });
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open('neuron.collection:offline-reader');
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction(['notes', 'cards', 'reviews']);
    const rows = await Promise.all(
      ['notes', 'cards', 'reviews'].map(
        (entity) =>
          new Promise<unknown[]>((resolve) => {
            const request = tx.objectStore(entity).getAll();
            request.onsuccess = () => resolve(request.result);
          }),
      ),
    );
    db.close();
    return rows;
  });
  expect(stored.map((rows) => rows.length)).toEqual([1, 1, 1]);
  expect(stored[1]?.[0]).toMatchObject({ row: { placedDue: date, resetAt: null, stability: 3 } });
  expect(stored[2]?.[0]).toMatchObject({ row: review });
  await offline(second, context);
  await expect(second.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
});

test('a stale final page cannot complete a newer partial download from another tab', async ({
  page,
  context,
}) => {
  let oldFinal: Route | undefined;
  let retryFinal: Route | undefined;
  let competingFinal: Route | undefined;
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      if (since === 0) return route.fulfill({ json: first });
      if (since === 1) oldFinal = route;
      else retryFinal = route;
    },
  });
  await page.goto('/library');
  await expect.poll(() => Boolean(oldFinal)).toBe(true);
  const second = await context.newPage();
  await installOfflineFixtures(second, context, {
    pull: async (route, since) => {
      if (since === 1) return route.fulfill({ json: { ...last, hasMore: true } });
      competingFinal = route;
    },
  });
  await second.goto('/library');
  await expect.poll(() => Boolean(competingFinal)).toBe(true);
  expect(await meta(page)).toEqual({ cursor: 2, complete: false, format: 1 });
  await oldFinal!.fulfill({ json: last });
  await expect.poll(() => Boolean(retryFinal)).toBe(true);
  expect(await meta(page)).toEqual({ cursor: 2, complete: false, format: 1 });
  const changed = {
    ...note,
    rev: 3,
    fields: { ...note.fields, translation: 'Concurrent meaning' },
  };
  const final = { since: 2, revision: 3, hasMore: false, changes: [change('notes', changed)] };
  await competingFinal!.fulfill({ json: final });
  await retryFinal!.fulfill({ json: final });
  await expect.poll(() => meta(page)).toEqual({ cursor: 3, complete: true, format: 1 });
  await offline(page, context);
  await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await page.getByRole('button', { name: /Durable word/ }).click();
  await expect(page.getByText('Concurrent meaning', { exact: true })).toBeVisible();
});

test('quota failure commits neither rows nor completeness and recovers from the same cursor', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'cards' && !sessionStorage.getItem('quota-recovered'))
        throw new DOMException('Quota full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await installOfflineFixtures(page, context);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  expect(await meta(page)).toEqual({ cursor: 1, complete: false, format: 1 });
  await page.evaluate(() => sessionStorage.setItem('quota-recovered', 'true'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
});

test('reconnection rejection revokes offline access instead of using a remembered server session', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  await offline(page, context);
  await page.route('**/api/account', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'not_authenticated', status: 401, correlationId: 'expired-session' } },
    }),
  );
  await context.setOffline(false);
  await expect(page).toHaveURL(/sign-in/);
  expect(await page.evaluate(() => localStorage.getItem('neuron.offline.account'))).toBeNull();
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Sign in', exact: true }).count();
  await expect(page.getByText('Downloaded Folder', { exact: true })).toHaveCount(0);
});

test('future database versions block unsafe rebuild without changing online behavior', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  await page.evaluate(async () => {
    const request = indexedDB.open('neuron.collection:offline-reader', 4);
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: /Deutsch/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild downloaded collection', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild now', exact: true }).click();
  await expect(
    page.getByText(
      'The downloaded collection could not be rebuilt. Close other Neuron windows and try again.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
});

test('sign-out in one tab removes ordinary offline access in the other tab', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  const second = await context.newPage();
  await installOfflineFixtures(second, context);
  await second.goto('/library');
  await offline(page, context);
  await expect(second.getByText('Offline · collection reading', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(second).toHaveURL(/sign-in/);
  await context.setOffline(false);
  await second.goto('/library');
  await expect(second).toHaveURL(/sign-in/);
});

test('unavailable IndexedDB keeps the online app usable without claiming offline readiness', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get: () => {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
  });
  await installOfflineFixtures(page, context);
  await page.goto('/library');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: /Deutsch/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await offline(page, context);
  await expect(page.getByText(/collection download is incomplete/)).toBeVisible();
});

test('outdated local format can be rebuilt online and missing data never looks like an empty snapshot', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  await page.evaluate(async () => {
    const request = indexedDB.open('neuron.collection:offline-reader');
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ cursor: 2, complete: true, format: 99 }, 'sync');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild downloaded collection', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild now', exact: true }).click();
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  await page.evaluate(async () => {
    const request = indexedDB.deleteDatabase('neuron.collection:offline-reader');
    await new Promise<void>((resolve) => {
      request.onsuccess = () => resolve();
    });
  });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await offline(page, context);
  await expect(
    page.getByText(/Downloaded data is missing|collection download is incomplete/).first(),
  ).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  await offline(page, context);
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
});

test('background hydration and stable failure never shift or remount screen headers', async ({
  page,
  context,
}) => {
  let held: Route | undefined;
  let pulls = 0;
  let accountReads = 0;
  let fail = true;
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('Offline collection failure')) diagnostics.push(message.text());
  });
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      pulls++;
      if (since === 0) {
        held = route;
        return;
      }
      await route.fulfill({
        json: fail
          ? {
              ...last,
              changes: [
                change('notes', {
                  ...note,
                  source: { privateField: 'DO_NOT_LOG_COLLECTION_CONTENT' },
                }),
              ],
            }
          : last,
      });
    },
  });
  await page.route('**/api/account', async (route) => {
    accountReads++;
    await route.fulfill({ json: account });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect.poll(() => Boolean(held)).toBe(true);
  const today = page.getByRole('heading', { name: 'Today', exact: true });
  const top = (await today.boundingBox())!.y;
  await today.evaluate((element) => element.setAttribute('data-stable-header', 'retained'));
  for (let index = 0; index < 3; index++)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(pulls).toBe(1);
  expect((await today.boundingBox())!.y).toBe(top);
  await expect(page.getByText(/Downloading for offline reading/)).toHaveCount(0);
  await held!.fulfill({ json: first });
  await expect.poll(() => diagnostics.length).toBe(1);
  expect(diagnostics[0]).toContain('schema');
  expect(diagnostics[0]).toContain('source');
  expect(diagnostics[0]).not.toContain('DO_NOT_LOG_COLLECTION_CONTENT');
  expect((await today.boundingBox())!.y).toBe(top);
  await expect(today).toHaveAttribute('data-stable-header', 'retained');
  await expect(page.getByText('The offline collection is not ready.')).toHaveCount(0);
  const failedPulls = pulls;
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  for (const name of ['Library', 'Settings', 'Today']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
  await expect.poll(() => accountReads).toBeGreaterThan(1);
  expect(pulls).toBe(failedPulls);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/collection row could not be validated/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rebuild downloaded collection' })).toHaveCount(0);
  const settings = page.getByRole('heading', { name: 'Settings', exact: true });
  const settingsTop = await settings.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY,
  );
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  expect(
    await settings.evaluate((element) => element.getBoundingClientRect().top + window.scrollY),
  ).toBe(settingsTop);
  await expect(page.locator('main').getByText(/Downloading for offline reading/)).toHaveCount(0);
});

test('failed incremental sync retains a completed snapshot and ordinary focus does not retry it', async ({
  page,
  context,
}) => {
  let fail = false;
  let pulls = 0;
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      pulls++;
      if (fail) return route.abort('internetdisconnected');
      await route.fulfill({
        json:
          since === 0
            ? first
            : since === 1
              ? last
              : { since, revision: since, hasMore: false, changes: [] },
      });
    },
  });
  await download(page);
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/download could not reach the server/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rebuild downloaded collection' })).toHaveCount(0);
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  const failedPulls = pulls;
  for (let index = 0; index < 3; index++)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(pulls).toBe(failedPulls);
  expect(await meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await offline(page, context);
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
});

const nestedId = '01900000-0000-7000-8000-000000000006';
async function installContinuityFixtures(page: Page, context: BrowserContext, complete = true) {
  await installPreferences(page, { motion: 'reduce' });
  const nested = { ...folder, id: nestedId, parentId: folderId, name: 'Nested Folder' };
  const leaf = { ...deck, parentId: nestedId };
  const notes = Array.from({ length: 60 }, (_, index) => ({
    ...note,
    id:
      index === 0
        ? noteId
        : `01900000-0000-7000-8000-${(index + 100).toString().padStart(12, '0')}`,
    fields: {
      term: index === 0 ? 'Durable word' : `Word ${index}`,
      translation: `Downloaded meaning ${index}`,
    },
  }));
  const tree = [
    {
      ...folder,
      path: [],
      due: 0,
      fresh: 0,
      noteCount: notes.length,
      children: [
        {
          ...nested,
          path: [folderId],
          due: 0,
          fresh: 0,
          noteCount: notes.length,
          children: [
            {
              ...leaf,
              path: [folderId, nestedId],
              due: 0,
              fresh: 0,
              noteCount: notes.length,
              children: [],
            },
          ],
        },
      ],
    },
  ];
  const control = {
    lost: false,
    updated: false,
    accountReads: 0,
    collectionReads: 0,
    holdAccount: undefined as Promise<void> | undefined,
  };
  await installOfflineFixtures(page, context, {
    pull: async (route, since) => {
      if (!complete && since === 1) return route.abort('internetdisconnected');
      await route.fulfill({
        json:
          since === 0
            ? { ...first, changes: [folder, nested, leaf].map((row) => change('decks', row)) }
            : since === 1
              ? {
                  ...last,
                  changes: [
                    ...notes.map((row) => change('notes', row)),
                    change('cards', card),
                    change('reviews', review),
                  ],
                }
              : control.updated && since === 2
                ? {
                    since,
                    revision: 3,
                    hasMore: false,
                    changes: [
                      change('notes', {
                        ...notes[0],
                        rev: 3,
                        fields: { term: 'Durable word', translation: 'Reconciled meaning' },
                      }),
                    ],
                  }
                : { since, revision: since, hasMore: false, changes: [] },
      });
    },
  });
  await page.route('**/api/account', async (route) => {
    control.accountReads++;
    if (control.lost) return route.abort('internetdisconnected');
    if (control.holdAccount) await control.holdAccount;
    await route.fulfill({ json: account }).catch(() => undefined);
  });
  await page.route('**/api/decks', async (route) => {
    if (control.lost) return route.abort('internetdisconnected');
    await route.fulfill({ json: { decks: tree } });
  });
  await page.route('**/api/notes?*', async (route) => {
    control.collectionReads++;
    if (control.lost) return route.abort('internetdisconnected');
    const search = new URL(route.request().url()).searchParams.get('search')?.toLowerCase() ?? '';
    const current = notes.map((row, index) =>
      control.updated && index === 0
        ? { ...row, fields: { ...row.fields, translation: 'Reconciled meaning' } }
        : row,
    );
    await route.fulfill({
      json: {
        items: current.filter((row) =>
          `${JSON.stringify(row.fields)} ${row.tags.join(' ')}`.toLowerCase().includes(search),
        ),
      },
    });
  });
  await page.route(`**/api/notes/${noteId}`, async (route) => {
    if (control.lost) return route.abort('internetdisconnected');
    await route.fulfill({ json: { note: notes[0], cards: [card] } });
  });
  await page.route(`**/api/decks/${deckId}/practice`, (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  return control;
}

async function geometry(page: Page) {
  return page.evaluate(() => ({
    header: document.querySelector('main header')?.getBoundingClientRect().top,
    rows: document.querySelector('[data-rows]')?.getBoundingClientRect().top,
    scroll: scrollY,
  }));
}

test('in-session Library keeps its header, nested expansion and row geometry when connection disappears', async ({
  page,
  context,
}) => {
  await installContinuityFixtures(page, context);
  await download(page);
  await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();
  await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();
  const row = page.locator(`[data-collection-id="${deckId}"]`);
  await expect(row.getByText('60 notes', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const before = await row.boundingBox();
  const header = await geometry(page);
  await page
    .locator('[data-library-view]')
    .evaluate((element) => element.setAttribute('data-visit', 'same-library'));
  await offline(page, context);
  await expect(page.locator('[data-visit="same-library"]')).toHaveCount(1);
  expect(await row.boundingBox()).toEqual(before);
  expect(await geometry(page)).toEqual(header);
  await expect(page.getByRole('button', { name: /Drag/i })).toHaveCount(0);
  for (const button of await page.getByRole('button', { name: /New deck|New folder/i }).all())
    await expect(button).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hide what is inside', exact: true })).toHaveCount(
    2,
  );
  await row.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await expect(page.getByPlaceholder('Word, meaning or tag')).toBeVisible();
  await page.getByRole('searchbox').fill('cached');
  await expect(page.getByRole('searchbox')).not.toHaveAttribute('aria-busy', 'true');
  await expect(
    page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('meaning 0');
  await expect(page.locator('[data-rows] [data-row]')).toHaveCount(1);
  await page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }).click();
  await expect(page.getByRole('textbox', { name: 'Translation' })).toHaveValue(
    'Downloaded meaning 0',
  );
  await expect(page.locator('[data-direct-delete]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Downloaded Deck', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
});

// Exercise a wrapped unavailable label as well as each project's normal viewport.
for (const width of [undefined, 320]) {
  test(`transport loss with online browser hints preserves the open Deck and scroll, then validates before reconnecting${width ? ` at ${width}px` : ''}`, async ({
    page,
    context,
  }) => {
    if (width) await page.setViewportSize({ width, height: 812 });
    const control = await installContinuityFixtures(page, context);
    await download(page);
    await page.goto(`/notes?deckId=${deckId}`);
    await expect(
      page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }),
    ).toBeVisible();
    await page
      .locator('main section[data-screen]')
      .evaluate((element) => element.setAttribute('data-visit', 'same-deck'));
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeVisible();
    await page.getByRole('searchbox').fill('cached');
    await expect(page.getByRole('searchbox')).not.toHaveAttribute('aria-busy', 'true');
    // Refetch the same search result set while scroll is away from the page top.
    await page.evaluate(() => scrollTo(0, 500));
    const before = await geometry(page);
    const accounts = control.accountReads;
    control.lost = true;
    await page.getByRole('searchbox').evaluate((element) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Cached',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.locator('[data-visit="same-deck"]')).toHaveCount(1);
    expect(await geometry(page)).toEqual(before);
    expect(control.accountReads).toBe(accounts + 1);
    const requests = control.collectionReads;
    await page.getByRole('searchbox').fill('meaning 0');
    await page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }).click();
    await expect(page.getByRole('textbox', { name: 'Translation' })).toHaveValue(
      'Downloaded meaning 0',
    );
    expect(control.collectionReads).toBe(requests);
    await page.getByRole('button', { name: 'Downloaded Deck', exact: true }).click();
    for (const name of ['New note', 'Import', 'Select notes', 'Practice requires a connection.'])
      await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    control.lost = false;
    control.updated = true;
    let release!: () => void;
    control.holdAccount = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(() => control.accountReads).toBe(accounts + 2);
      await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
      release();
      await expect(page.getByText('Offline · collection reading', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: /Durable word Reconciled meaning/ }),
      ).toBeVisible();
      await expect.poll(() => meta(page)).toEqual({ cursor: 3, complete: true, format: 1 });
    } finally {
      release();
    }
  });
}

test('incomplete snapshot never presents cached online collection rows as available offline', async ({
  page,
  context,
}) => {
  const control = await installContinuityFixtures(page, context, false);
  await page.goto('/library');
  await expect(page.getByRole('button', { name: /^Downloaded Folder/ })).toBeVisible();
  await expect.poll(() => meta(page)).toEqual({ cursor: 1, complete: false, format: 1 });
  await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /^Nested Folder/ }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await expect(
    page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }),
  ).toBeVisible();
  control.lost = true;
  await page.getByRole('searchbox').fill('cached');
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'The collection download is incomplete or missing. Connect and sign in to finish downloading before browsing offline.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(page.locator('[data-rows]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeDisabled();
});

test('HTTP read errors and isolated failed mutations do not establish a transport outage', async ({
  page,
  context,
}) => {
  const control = await installContinuityFixtures(page, context);
  await download(page);
  await page.goto(`/notes?deckId=${deckId}`);
  await expect(
    page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }),
  ).toBeVisible();
  const accounts = control.accountReads;
  await page.route(`**/api/notes/${noteId}`, (route) => route.abort('internetdisconnected'));
  const rejected = page.waitForEvent('requestfailed', (request) => request.method() === 'DELETE');
  await page.locator('[data-direct-delete]').first().click();
  await rejected;
  await expect(
    page.getByRole('button', { name: /Durable word Downloaded meaning 0/ }),
  ).toBeVisible();
  await expect(page.getByText('Offline · collection reading', { exact: true })).toHaveCount(0);
  expect(control.accountReads).toBe(accounts);
  await page.route('**/api/notes?*', (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: 'validation_error', status: 400, correlationId: 'rejected-read' } },
    }),
  );
  const failed = page.waitForResponse((response) => response.status() === 400);
  await page.getByRole('searchbox').fill('bad filter');
  await failed;
  await expect(page.getByText('Offline · collection reading', { exact: true })).toHaveCount(0);
  expect(control.accountReads).toBe(accounts);
});

test('a late account validation cannot reactivate online controls after connectivity changes again', async ({
  page,
  context,
}) => {
  await installOfflineFixtures(page, context);
  await download(page);
  await offline(page, context);
  let held: Route | undefined;
  await page.route('**/api/account', (route) => {
    held = route;
  });
  await context.setOffline(false);
  await expect.poll(() => Boolean(held)).toBe(true);
  await context.setOffline(true);
  await held!.fulfill({ json: account }).catch(() => undefined);
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
  for (const button of await page.getByRole('button', { name: /New deck|New folder/i }).all())
    await expect(button).toBeDisabled();
  await page.getByRole('button', { name: /^Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /^Downloaded Deck/ }).click();
  await page.getByRole('button', { name: /Durable word/ }).click();
  await expect(page.getByRole('textbox', { name: 'Translation' })).toHaveValue(
    'Downloaded meaning',
  );
});
