import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures } from './fixtures';

import type { BrowserContext, Page, Route } from '@playwright/test';

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

async function useOfflineFixtures(
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
  await context.setOffline(true);
  await expect(page.getByText('Offline · collection reading', { exact: true })).toBeVisible();
}

test('complete download, offline folders/decks/notes/details and read-only route boundaries', async ({
  page,
  context,
}) => {
  await useOfflineFixtures(page, context);
  await download(page);
  await offline(page, context);
  await page.getByRole('button', { name: /Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /Downloaded Deck/ }).click();
  await page.getByRole('button', { name: 'Durable word', exact: true }).click();
  await expect(page.getByText('Downloaded meaning', { exact: true })).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
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
      const content = await readFile(path.join(process.cwd(), 'dist', asset));
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
        asset === 'sw.js' && updatedWorker
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
  });
  const page = await context.newPage();
  try {
    await download(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await page.reload();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: /Downloaded Folder/ })).toBeVisible();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/library`);
    await expect(reopened.getByRole('button', { name: /Downloaded Folder/ })).toBeVisible();
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
  await useOfflineFixtures(page, context, {
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
  await expect(page.getByRole('button', { name: /Downloaded Folder/ })).toHaveCount(0);
  interrupted = false;
  await page.reload();
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
  expect(cursors).toEqual([0, 1, 1]);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await offline(page, context);
  await expect(page.getByRole('button', { name: /Downloaded Folder/ })).toBeVisible();
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
  await useOfflineFixtures(page, context);
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
  await useOfflineFixtures(page, context, {
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
  await page.getByRole('button', { name: /Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /Downloaded Deck/ }).click();
  await expect(page.getByText('No items here.', { exact: true })).toBeVisible();
});

test('explicit offline sign-out revokes remembered access and account switching isolates collections', async ({
  page,
  context,
}) => {
  await useOfflineFixtures(page, context);
  // Ordinary fixture tests block the worker; warm the auth module as the real precached shell does.
  await page.goto('/sign-in');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await download(page);
  await offline(page, context);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  expect(await page.evaluate(() => localStorage.getItem('neuron.offline.account'))).toBeNull();
  await context.setOffline(false);
  await useOfflineFixtures(page, context, {
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
  await expect(page.getByRole('button', { name: /Downloaded Folder/ })).toHaveCount(0);
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
  await useOfflineFixtures(page, context, {
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
  await useOfflineFixtures(page, context, {
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
  await useOfflineFixtures(second, context);
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
  await expect(second.getByRole('button', { name: /Downloaded Folder/ })).toBeVisible();
});

test('a stale final page cannot complete a newer partial download from another tab', async ({
  page,
  context,
}) => {
  let oldFinal: Route | undefined;
  let retryFinal: Route | undefined;
  let competingFinal: Route | undefined;
  await useOfflineFixtures(page, context, {
    pull: async (route, since) => {
      if (since === 0) return route.fulfill({ json: first });
      if (since === 1) oldFinal = route;
      else retryFinal = route;
    },
  });
  await page.goto('/library');
  await expect.poll(() => Boolean(oldFinal)).toBe(true);
  const second = await context.newPage();
  await useOfflineFixtures(second, context, {
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
  await page.getByRole('button', { name: /Downloaded Folder/ }).click();
  await page.getByRole('button', { name: /Downloaded Deck/ }).click();
  await page.getByRole('button', { name: 'Durable word', exact: true }).click();
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
  await useOfflineFixtures(page, context);
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
  await useOfflineFixtures(page, context);
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

test('future database versions fail safely and can be rebuilt without changing online behavior', async ({
  page,
  context,
}) => {
  await useOfflineFixtures(page, context);
  await download(page);
  await page.evaluate(async () => {
    const request = indexedDB.open('neuron.collection:offline-reader', 2);
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
  await expect.poll(() => meta(page)).toEqual({ cursor: 2, complete: true, format: 1 });
});

test('sign-out in one tab removes ordinary offline access in the other tab', async ({
  page,
  context,
}) => {
  await useOfflineFixtures(page, context);
  await download(page);
  const second = await context.newPage();
  await useOfflineFixtures(second, context);
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
  await useOfflineFixtures(page, context);
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
  await useOfflineFixtures(page, context);
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
  await expect(page.getByRole('button', { name: /Downloaded Folder/ })).toBeVisible();
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
  await useOfflineFixtures(page, context, {
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
  await useOfflineFixtures(page, context, {
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
  await expect(page.getByRole('button', { name: /Downloaded Folder/ })).toBeVisible();
});
