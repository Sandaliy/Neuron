import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures } from './fixtures';

import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const id = '01900000-0000-7000-8000-000000000201';
const date = '2026-10-10T00:00:00.000Z';
const account = {
  id: 'offline-writer',
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
  revision: 1,
};
const original = {
  id,
  name: 'Original deck',
  kind: 'deck',
  parentId: null,
  position: 0,
  settings: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
};

async function stored(page: Page) {
  return page.evaluate(async (accountId) => {
    const opened = indexedDB.open(`neuron.collection:${accountId}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      return await new Promise<
        Array<{
          operationId: string;
          state: string;
          payload: Record<string, unknown>;
          base: { row: { name: string }; rev: number };
        }>
      >((resolve) => {
        const request = db.transaction('outbox').objectStore('outbox').getAll();
        request.onsuccess = () => resolve(request.result);
      });
    } finally {
      db.close();
    }
  }, account.id);
}

async function fixture(page: Page, kind: 'deck' | 'folder' = 'deck') {
  await installFixtures(page);
  const state = {
    offline: false,
    expired: false,
    who: account.id,
    lostAck: false,
    transport: false,
    reject: false,
    badAck: false,
    deleted: false,
    deck: { ...original, kind },
    deliveries: [] as Record<string, unknown>[],
    receipts: new Map<string, Record<string, unknown>>(),
  };
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
          state.who === account.id && !state.deleted
            ? [{ ...state.deck, path: [], children: [], noteCount: 0, due: 0, fresh: 0 }]
            : [],
      },
    }),
  );
  await page.route('**/api/sync?*', (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    return state.offline
      ? route.abort('internetdisconnected')
      : route.fulfill({
          json: {
            since,
            revision: Math.max(since, state.deck.rev),
            hasMore: false,
            changes:
              state.deck.rev > since
                ? [
                    {
                      entity: 'decks',
                      id,
                      rev: state.deck.rev,
                      deleted: state.deleted,
                      purged: false,
                      row: state.deck,
                    },
                  ]
                : [],
          },
        });
  });
  await page.route('**/api/decks/*/rename', async (route) => {
    const body = route.request().postDataJSON();
    state.deliveries.push(body);
    if (state.transport) return route.abort('connectionreset');
    if (state.reject)
      return route.fulfill({
        status: 403,
        json: { error: { code: 'sync_rejected', status: 403, correlationId: 'refused' } },
      });
    let receipt = state.receipts.get(body.operationId);
    if (!receipt) {
      const conflict = state.deleted || body.baseRev !== state.deck.rev;
      if (!conflict) state.deck = { ...state.deck, name: body.name, rev: state.deck.rev + 1 };
      receipt = {
        operationId: body.operationId,
        status: conflict ? 'conflict' : 'applied',
        revision: state.deck.rev,
        ...(conflict ? { reason: state.deleted ? 'deleted_remotely' : 'changed_remotely' } : {}),
      };
      state.receipts.set(body.operationId, receipt);
    }
    if (state.lostAck) {
      state.lostAck = false;
      return route.abort('connectionreset');
    }
    return route.fulfill({ json: state.badAck ? { ...receipt, revision: body.baseRev } : receipt });
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
  await page.getByRole('link', { name: 'Library', exact: true }).click();
}
async function rename(page: Page, name = 'Saved offline name') {
  await page.getByRole('button', { name: 'Actions for Original deck', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox').fill(name);
  await page.getByRole('button', { name: 'Save the name', exact: true }).click();
}
async function reconnect(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('offline rename survives reload; lost acknowledgement retries the exact operation once', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await rename(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const saved = (await stored(page))[0]!;
  expect(saved.base.row.name).toBe('Original deck');
  expect(saved.payload.baseRev).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Saved offline name/ })).toBeVisible();
  state.lostAck = true;
  await reconnect(page, state);
  await expect.poll(() => state.deliveries.length).toBe(1);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.deliveries).toEqual([saved.payload, saved.payload]);
  expect(state.deck.rev).toBe(2);
  await page.reload();
  await expect(
    page.getByText('Everything is saved to your account.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Recent activity', exact: true }).click();
  await page
    .getByRole('region', { name: 'Saved name changes' })
    .getByRole('button', { name: 'Saved offline name', exact: true })
    .click();
  await expect(page.getByText('Synchronized with the server', { exact: true })).toBeVisible();
  expect(state.deliveries).toHaveLength(2);
});

test('an existing Folder can be renamed offline and synchronized after reopening', async ({
  page,
}) => {
  const state = await fixture(page, 'folder');
  await disconnect(page, state);
  await rename(page, 'Saved folder name');
  await expect(
    page.getByText('Name saved on this device. It will sync after sign-in is confirmed.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  await page.reload();
  await expect(page.getByRole('button', { name: /^Saved folder name/ })).toBeVisible();
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.deck.kind).toBe('folder');
  expect(state.deck.name).toBe('Saved folder name');
});

test('invalid acknowledgement and failed acknowledgement persistence keep the exact pending operation', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await rename(page);
  const saved = (await stored(page))[0]!;
  state.badAck = true;
  await reconnect(page, state);
  await expect.poll(() => state.deliveries.length).toBe(1);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  await expect
    .poll(() =>
      page.evaluate(async (accountId) => {
        const opened = indexedDB.open(`neuron.collection:${accountId}`);
        const db = await new Promise<IDBDatabase>((resolve) => {
          opened.onsuccess = () => resolve(opened.result);
        });
        const read = db.transaction('meta').objectStore('meta').get('sync');
        const cursor = await new Promise<number>((resolve) => {
          read.onsuccess = () => resolve(read.result.cursor);
        });
        db.close();
        return cursor;
      }, account.id),
    )
    .toBe(2);
  // Let the local save notification finish before asking for an explicit retry.
  // A local commit must not queue the online-write follow-up while this invalid
  // acknowledgement leaves the original command pending.
  await expect(
    page.getByText('Name saved on this device. It will sync after sign-in is confirmed.', {
      exact: true,
    }),
  ).toBeHidden();
  expect(state.deliveries).toEqual([saved.payload]);
  state.badAck = false;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'outbox' && args[0].state === 'synchronized')
        throw new DOMException('Injected acknowledgement quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => state.deliveries.length).toBe(2);
  expect((await stored(page))[0]?.state).toBe('pending');
  await page.reload();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.deck.rev).toBe(2);
  expect(state.deliveries).toEqual([saved.payload, saved.payload, saved.payload]);
});

for (const remote of ['rename', 'delete', 'reject'] as const)
  test(`offline rename preserves losing intent on remote ${remote}`, async ({ page }) => {
    const state = await fixture(page);
    await disconnect(page, state);
    await rename(page);
    const saved = (await stored(page))[0]!;
    state.deck = { ...state.deck, name: 'Other device name', rev: 2 };
    state.deleted = remote === 'delete';
    state.reject = remote === 'reject';
    await reconnect(page, state);
    await expect
      .poll(async () => (await stored(page))[0]?.state)
      .toBe(remote === 'reject' ? 'rejected' : 'conflict');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Saved offline name', { exact: true })).toBeVisible();
    expect((await stored(page))[0]!.payload).toEqual(saved.payload);
    expect((await stored(page))[0]!.base).toEqual(saved.base);
    if (remote === 'rename') {
      await page.screenshot({
        path: '../../.local-tools/phase82/rename-conflict.png',
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Apply saved name to current version', exact: true })
        .click();
      await expect
        .poll(
          async () => (await stored(page)).filter((entry) => entry.state === 'synchronized').length,
        )
        .toBe(1);
      expect(state.deck.name).toBe('Saved offline name');
      expect(state.deliveries[1]?.baseRev).toBe(2);
      expect(state.deliveries[1]?.operationId).not.toBe(saved.operationId);
    } else {
      if (remote === 'reject') {
        await page.evaluate(() => {
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'outbox') {
              IDBObjectStore.prototype.put = put;
              throw new DOMException('Injected archive quota', 'QuotaExceededError');
            }
            return put.apply(this, args);
          };
        });
        await page
          .getByRole('button', { name: 'Keep server version and archive saved name' })
          .click();
        await expect(page.getByRole('alert')).toContainText('saved');
        expect((await stored(page))[0]!.state).toBe('rejected');
        expect((await stored(page))[0]!.payload).toEqual(saved.payload);
        expect((await stored(page))[0]!.base).toEqual(saved.base);
      }
      await page
        .getByRole('button', { name: 'Keep server version and archive saved name' })
        .click();
      await expect.poll(async () => (await stored(page))[0]?.state).toBe('resolved');
      expect((await stored(page))[0]!.payload).toEqual(saved.payload);
    }
  });

test('expiry, explicit sign-out and another account retain pending work without delivery or exposure', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await rename(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  state.expired = true;
  await reconnect(page, state);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.deliveries).toHaveLength(0);
  expect((await stored(page))[0]?.state).toBe('pending');
  // A subsequent explicit sign-in can select another account, never the old database.
  state.expired = false;
  state.who = 'different-writer';
  await page.evaluate(() => localStorage.removeItem('neuron.offline.signedOut'));
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Saved offline name', { exact: true })).toHaveCount(0);
  expect(state.deliveries).toHaveLength(0);
  expect((await stored(page))[0]?.state).toBe('pending');
  state.who = account.id;
  await page.goto('/settings');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.deliveries).toHaveLength(1);
});

test('quota failure and transaction interruption cannot commit a name without its outgoing intent', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'outbox') throw new DOMException('Injected quota', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await rename(page);
  await expect(
    page.getByText(
      'The name could not be saved on this device. Your previous name is unchanged. Try again.',
    ),
  ).toBeVisible();
  expect(await stored(page)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Original deck/ })).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'outbox') this.transaction.abort();
      return request;
    };
  });
  await rename(page);
  await expect(
    page.getByText(
      'The name could not be saved on this device. Your previous name is unchanged. Try again.',
    ),
  ).toBeVisible();
  expect(await stored(page)).toEqual([]);
});

test('future database versions block recovery and retain the immutable outbox', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await rename(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const saved = await stored(page);
  await page.evaluate(async (accountId) => {
    const opened = indexedDB.open(`neuron.collection:${accountId}`, 4);
    await new Promise<void>((resolve, reject) => {
      opened.onsuccess = () => {
        opened.result.close();
        resolve();
      };
      opened.onerror = () => reject(opened.error);
    });
  }, account.id);
  await reconnect(page, state);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Saved name changes' })
      .getByText(
        'Saved changes could not be read. Rebuild is blocked until they can be checked safely.',
      ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild downloaded collection', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild now', exact: true }).click();
  expect(await stored(page)).toEqual(saved);
  expect(state.deliveries).toHaveLength(0);
});

test('rebuild is serialized with pending writes and cannot delete unsynchronized intent', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await rename(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const saved = await stored(page);
  state.transport = true;
  state.deck.rev++;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'decks') throw new DOMException('Injected quota', 'QuotaExceededError');
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
  expect(await stored(page)).toEqual(saved);
});

test('explicit offline sign-out retains pending work and cannot resume it from a still-valid cookie', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await rename(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const saved = await stored(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  state.offline = false;
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await stored(page)).toEqual(saved);
  expect(state.deliveries).toHaveLength(0);
});

test('rename retains the originally observed revision when a background pull advances the dialog', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await page.getByRole('button', { name: 'Actions for Original deck', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.evaluate(
    async ({ accountId, entityId }) => {
      const opened = indexedDB.open(`neuron.collection:${accountId}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        opened.onsuccess = () => resolve(opened.result);
      });
      const tx = db.transaction('decks', 'readwrite');
      const store = tx.objectStore('decks');
      const read = store.get(entityId);
      read.onsuccess = () =>
        store.put({
          ...read.result,
          rev: 2,
          row: { ...read.result.row, name: 'Other device name', rev: 2 },
        });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { accountId: account.id, entityId: id },
  );
  await page.getByRole('textbox').fill('Observed intent');
  await page.getByRole('button', { name: 'Save the name', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.payload.baseRev).toBe(1);
  expect((await stored(page))[0]?.base.row.name).toBe('Original deck');
  state.deck = { ...state.deck, name: 'Other device name', rev: 2 };
  await reconnect(page, state);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('conflict');
  expect(state.deck.name).toBe('Other device name');
});

for (const pending of [false, true])
  test(`compatible database upgrade preserves collection and ${pending ? 'pending work' : 'legacy data'}`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await disconnect(page, state);
    if (pending) await rename(page);
    const saved = await stored(page);
    // A prior compatible schema can already contain a future store. Upgrade must
    // add missing stores without recreating or clearing existing user records.
    await page.evaluate(
      async ({ accountId, pending }) => {
        const name = `neuron.collection:${accountId}`;
        const opened = indexedDB.open(name);
        const db = await new Promise<IDBDatabase>((resolve) => {
          opened.onsuccess = () => resolve(opened.result);
        });
        const names = Array.from(db.objectStoreNames).filter(
          (name) => pending || name !== 'outbox',
        );
        const copies = await Promise.all(
          names.map(async (name) => {
            const store = db.transaction(name).objectStore(name);
            const values = store.getAll();
            const keys = store.getAllKeys();
            await new Promise<void>((resolve) => {
              keys.onsuccess = () => resolve();
            });
            return {
              name,
              keyPath: store.keyPath as string | null,
              values: values.result,
              keys: keys.result,
            };
          }),
        );
        db.close();
        const removed = indexedDB.deleteDatabase(name);
        await new Promise<void>((resolve) => {
          removed.onsuccess = () => resolve();
        });
        const legacy = indexedDB.open(name, 1);
        legacy.onupgradeneeded = () => {
          for (const copy of copies) {
            const store = legacy.result.createObjectStore(
              copy.name,
              copy.keyPath ? { keyPath: copy.keyPath } : undefined,
            );
            copy.values.forEach((value, at) =>
              copy.keyPath ? store.put(value) : store.put(value, copy.keys[at]),
            );
          }
        };
        await new Promise<void>((resolve) => {
          legacy.onsuccess = () => {
            legacy.result.close();
            resolve();
          };
        });
      },
      { accountId: account.id, pending },
    );
    await page.reload();
    await expect(
      page.getByRole('button', { name: pending ? /^Saved offline name/ : /^Original deck/ }),
    ).toBeVisible();
    expect(await stored(page)).toEqual(saved);
    expect(state.deliveries).toHaveLength(0);
  });

test('a validated downloaded collection saves names durably before server acknowledgement', async ({
  page,
}) => {
  const state = await fixture(page);
  state.transport = true;
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await rename(page, 'Local first name');
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('pending');
  const saved = (await stored(page))[0]!;
  expect(saved.payload.name).toBe('Local first name');
  expect(saved.base.row.name).toBe('Original deck');
  await expect(page.getByRole('button', { name: /^Local first name/ })).toBeVisible();
  await expect(
    page.getByText('Name saved on this device. It will sync after sign-in is confirmed.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => state.deliveries.length).toBeGreaterThan(0);
  expect(state.deliveries[0]).toEqual(saved.payload);
});

test('an open rename keeps its draft and focus through loss and matching validation', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Original deck', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.fill('Retained name draft');
  await input.evaluate((element) => element.setAttribute('data-retained-name', 'true'));
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(input).toHaveValue('Retained name draft');
  await expect(input).toBeFocused();
  await reconnect(page, state);
  await expect(page.getByText('Offline', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-retained-name="true"]')).toBeFocused();
  await expect(input).toHaveValue('Retained name draft');
  await page.getByRole('button', { name: 'Save the name', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.payload.name).toBe('Retained name draft');
});
