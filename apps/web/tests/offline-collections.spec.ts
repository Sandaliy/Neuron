import { expect, test } from '@playwright/test';

import type {
  CreateOfflineDeckCommand,
  CreateOfflineDeckResult,
  Deck,
  DeckNode,
  SavedDeckCreation,
} from '@neuron/shared';

import { useFixtures as installFixtures } from './fixtures';

import type { Page } from '@playwright/test';

const owner = 'offline-collection-creator';
const folderId = '01900000-0000-7000-8000-000000000901';
const date = '2026-10-31T00:00:00.000Z';
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
  settings: {},
  twoFactorEnabled: false,
  revision: 1,
};

export async function savedCollections(page: Page, accountId = owner) {
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
        .getAll(IDBKeyRange.bound('deck-create:', 'deck-create:\uffff'));
      return await new Promise<SavedDeckCreation[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, accountId);
}

export async function createCollection(page: Page, name: string, kind: 'folder' | 'deck' = 'deck') {
  await page
    .getByRole('button', { name: kind === 'folder' ? 'New folder' : 'New deck', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
}

async function fixture(page: Page) {
  await installFixtures(page);
  const folder: Deck = {
    id: folderId,
    kind: 'folder',
    name: 'Downloaded folder',
    parentId: null,
    path: [],
    position: 0,
    settings: { targetLanguage: 'de' },
    createdAt: date,
    updatedAt: date,
    rev: 1,
  };
  const state = {
    offline: false,
    expired: false,
    who: owner,
    lose: false,
    badAck: false,
    hold: false,
    conflict: undefined as 'name_exists' | 'identity_exists' | undefined,
    revision: 1,
    rows: [folder] as Deck[],
    removed: new Set<string>(),
    posted: [] as CreateOfflineDeckCommand[],
    receipts: new Map<string, CreateOfflineDeckResult>(),
  };
  await page.route('**/api/account', (route) =>
    state.offline
      ? route.abort('internetdisconnected')
      : state.expired
        ? route.fulfill({
            status: 401,
            json: { error: { code: 'not_authenticated', status: 401, correlationId: 'expired' } },
          })
        : route.fulfill({ json: { ...account, id: state.who, revision: state.revision } }),
  );
  const tree = () => {
    const nodes: DeckNode[] = state.rows
      .filter((row) => !state.removed.has(row.id))
      .map((row) => ({ ...row, children: [], due: 0, fresh: 0, noteCount: 0 }));
    const byId = new Map(nodes.map((row) => [row.id, row]));
    const roots: DeckNode[] = [];
    for (const row of nodes) {
      if (row.parentId) (byId.get(row.parentId)?.children as DeckNode[] | undefined)?.push(row);
      else roots.push(row);
    }
    return roots;
  };
  await page.route('**/api/decks', (route) =>
    state.offline
      ? route.abort('internetdisconnected')
      : route.fulfill({ json: { decks: state.who === owner ? tree() : [] } }),
  );
  await page.route('**/api/sync?*', (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    return state.offline
      ? route.abort('internetdisconnected')
      : route.fulfill({
          json: {
            since,
            revision: state.revision,
            hasMore: false,
            changes:
              state.who === owner
                ? state.rows
                    .filter((row) => row.rev > since)
                    .map((row) => ({
                      entity: 'decks',
                      id: row.id,
                      rev: row.rev,
                      deleted: state.removed.has(row.id),
                      purged: false,
                      row,
                    }))
                : [],
          },
        });
  });
  await page.route('**/api/decks/offline-create', async (route) => {
    const input = route.request().postDataJSON() as CreateOfflineDeckCommand;
    state.posted.push(input);
    if (state.expired)
      return route.fulfill({
        status: 401,
        json: {
          error: { code: 'not_authenticated', status: 401, correlationId: 'expired-delivery' },
        },
      });
    if (state.offline || state.hold) return route.abort('connectionreset');
    let result = state.receipts.get(input.operationId);
    if (!result) {
      const unavailable = input.parentId && state.removed.has(input.parentId);
      const changed = input.ancestors.some(
        (ancestor) => state.rows.find((row) => row.id === ancestor.id)?.rev !== ancestor.rev,
      );
      if (state.conflict || unavailable || changed)
        result = {
          operationId: input.operationId,
          entityId: input.entityId,
          status: 'conflict',
          reason: state.conflict ?? (unavailable ? 'parent_unavailable' : 'parent_changed'),
        };
      else {
        state.rows.push({
          id: input.entityId,
          name: input.name,
          kind: input.kind,
          parentId: input.parentId,
          path: input.ancestors.map((row) => row.id),
          settings: null,
          position: state.rows.length,
          rev: ++state.revision,
          createdAt: date,
          updatedAt: date,
        });
        result = {
          operationId: input.operationId,
          entityId: input.entityId,
          status: 'applied',
          revision: state.revision,
        };
      }
      state.receipts.set(input.operationId, result);
    }
    if (state.lose) {
      state.lose = false;
      return route.abort('connectionreset');
    }
    return route.fulfill({ json: state.badAck ? { ...result, entityId: folderId } : result });
  });
  await page.goto('/settings');
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'What works offline', exact: true }).click();
  await expect(
    page.getByText('Your collection is downloaded to this device.', { exact: true }),
  ).toBeVisible();
  return state;
}
async function disconnect(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('link', { name: 'Library', exact: true }).click();
}
async function reconnect(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('collection search uses the download offline, gates pending identities and clears results across accounts', async ({
  page,
}) => {
  const state = await fixture(page);
  const nestedId = '01900000-0000-7000-8000-000000000910';
  const deckId = '01900000-0000-7000-8000-000000000911';
  state.rows.push(
    {
      ...state.rows[0]!,
      id: nestedId,
      name: 'Nested folder',
      parentId: folderId,
      path: [folderId],
      rev: 2,
    },
    {
      ...state.rows[0]!,
      id: deckId,
      kind: 'deck',
      name: 'Downloaded lesson',
      parentId: nestedId,
      path: [folderId, nestedId],
      rev: 3,
    },
  );
  state.revision = 3;
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const opened = indexedDB.open('neuron.collection:offline-collection-creator');
        const db = await new Promise<IDBDatabase>((resolve) => {
          opened.onsuccess = () => resolve(opened.result);
        });
        try {
          const request = db.transaction('decks').objectStore('decks').count();
          return await new Promise<number>((resolve) => {
            request.onsuccess = () => resolve(request.result);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(3);
  await disconnect(page, state);
  await createCollection(page, 'Pending folder', 'folder');
  await createCollection(page, 'Pending deck');
  await page.getByRole('button', { name: 'Search the Library', exact: true }).click();
  await page.getByText('Folders & Decks', { exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search collection names' });
  await expect(page.getByText('Offline results from this device.', { exact: true })).toBeVisible();
  await search.fill('pending');
  for (const name of [
    'Pending folder Folder · Library Saved on device',
    'Pending deck Deck · Library Saved on device',
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/library\/find$/);
  }
  await expect(
    page.getByText('This Folder or Deck must sync before you can add to it or change it.').first(),
  ).toBeVisible();
  await search.fill('Downloaded lesson');
  await page
    .getByRole('button', {
      name: 'Downloaded lesson Deck · Library / Downloaded folder / Nested folder',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/notes\\?deckId=${deckId}`));
  await page.goBack();
  await expect(search).toHaveValue('Downloaded lesson');
  await page.reload();
  await search.fill('Downloaded lesson');
  await expect(page.getByRole('button', { name: /^Downloaded lesson Deck/ })).toBeVisible();
  expect(state.posted).toEqual([]);
  state.rows[0] = { ...state.rows[0]!, name: 'Renamed folder', rev: 4 };
  state.rows[2] = { ...state.rows[2]!, rev: 5 };
  state.removed.add(deckId);
  state.revision = 5;
  await reconnect(page, state);
  await expect(page.getByText('No collections match', { exact: true })).toBeVisible();
  await search.fill('Nested');
  await expect(
    page.getByRole('button', {
      name: 'Nested folder Folder · Library / Renamed folder',
      exact: true,
    }),
  ).toBeVisible();
  state.who = 'different-creator';
  await page.reload();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('Nested folder', { exact: true })).toHaveCount(0);
});

test('a complete download saves first even when connectivity disappears without an offline hint', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Downloaded folder/ })).toBeVisible();
  state.offline = true;
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await createCollection(page, 'Saved before transport', 'folder');
  await expect(page.getByRole('button', { name: /^Saved before transport/ })).toBeVisible();
  const entry = (await savedCollections(page))[0]!;
  expect(entry.state).toBe('pending');
  state.offline = false;
  await expect
    .poll(async () => (await savedCollections(page))[0]?.state, { timeout: 15_000 })
    .toBe('synchronized');
  expect(state.posted.every((row) => JSON.stringify(row) === JSON.stringify(entry.payload))).toBe(
    true,
  );
});

test('a server-backed online Folder missing from the download keeps the existing online creation path', async ({
  page,
}) => {
  const state = await fixture(page);
  const parent = {
    ...state.rows[0]!,
    id: '01900000-0000-7000-8000-000000000903',
    name: 'Online folder',
    rev: 2,
  };
  state.rows.push(parent);
  await page.route('**/api/sync?*', (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since'));
    return route.fulfill({ json: { since, revision: since, hasMore: false, changes: [] } });
  });
  const online: Record<string, unknown>[] = [];
  await page.route('**/api/decks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const input = route.request().postDataJSON();
    online.push(input);
    return route.fulfill({
      json: { deck: { ...parent, ...input, rev: 3, path: [parent.id], children: [] } },
    });
  });
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /^Online folder/ }).click();
  await createCollection(page, 'Online child');
  await expect(page.getByText('Created “Online child”', { exact: true })).toBeVisible();
  expect(online).toHaveLength(1);
  expect(online[0]).toMatchObject({ parentId: parent.id, name: 'Online child', kind: 'deck' });
  expect(await savedCollections(page)).toEqual([]);
  expect(state.posted).toEqual([]);
});

test('Folder and Deck creation survives reopening, retries exactly and blocks unsafe dependencies', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await createCollection(page, 'Local folder', 'folder');
  await expect(page.getByRole('button', { name: /^Local folder/ })).toBeVisible();
  await page.getByRole('button', { name: /^Local folder/ }).click();
  await createCollection(page, 'Unsupported child');
  await expect(
    page
      .getByText('This Folder or Deck must sync before you can add to it or change it.', {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  expect(await savedCollections(page)).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /^Downloaded folder/ }).click();
  await createCollection(page, 'Local deck');
  await expect(page.getByRole('button', { name: /^Local deck/ })).toBeVisible();
  const before = await savedCollections(page);
  expect(before.find((entry) => entry.payload.name === 'Local deck')?.payload).toMatchObject({
    parentId: folderId,
    ancestors: [{ id: folderId, rev: 1 }],
  });
  await page.getByRole('button', { name: /^Local deck/ }).click();
  await expect(page).toHaveURL(/\/library\?folderId=/);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Local deck/ })).toBeVisible();
  expect(await savedCollections(page)).toEqual(before);
  state.lose = true;
  await reconnect(page, state);
  await expect
    .poll(async () => (await savedCollections(page)).map((entry) => entry.state), {
      timeout: 20_000,
    })
    .toEqual(['synchronized', 'synchronized']);
  for (const entry of before) {
    const deliveries = state.posted.filter((row) => row.entityId === entry.payload.entityId);
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    for (const row of deliveries) expect(row).toEqual(entry.payload);
    expect(state.rows.filter((row) => row.id === entry.payload.entityId)).toHaveLength(1);
  }
  expect(state.posted.length).toBeGreaterThan(2);
  await expect(page.getByRole('button', { name: /^Local deck/ })).toBeVisible();
  await page.getByRole('button', { name: /^Local deck/ }).click();
  await expect(page).toHaveURL(/\/notes\?deckId=/);
});

test('a removed parent keeps work for an explicit destination choice with the same identity', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await page.getByRole('button', { name: /^Downloaded folder/ }).click();
  await createCollection(page, 'Retained deck');
  const saved = (await savedCollections(page))[0]!;
  state.removed.add(folderId);
  state.rows[0]!.rev = ++state.revision;
  await reconnect(page, state);
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('conflict');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Retained deck', exact: true });
  await expect(recovery.getByText(/Its Folder was deleted/)).toBeVisible();
  await recovery.getByLabel('Create inside', { exact: true }).selectOption('');
  await recovery.getByRole('button', { name: 'Create here', exact: true }).click();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('synchronized');
  const final = (await savedCollections(page))[0]!;
  expect(final.payload.entityId).toBe(saved.payload.entityId);
  expect(final.payload.operationId).not.toBe(saved.payload.operationId);
  expect(final.payload.parentId).toBeNull();
  expect(state.rows.filter((row) => row.id === saved.payload.entityId)).toHaveLength(1);
});

test('an open creation keeps its observed ancestry when a background pull moves the parent', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await page.getByRole('button', { name: /^Downloaded folder/ }).click();
  await page.getByRole('button', { name: 'New deck', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Original location');
  const target = {
    ...state.rows[0]!,
    id: '01900000-0000-7000-8000-000000000904',
    name: 'Other folder',
    rev: 2,
  };
  state.rows.push(target);
  state.rows[0] = { ...state.rows[0]!, parentId: target.id, path: [target.id], rev: 3 };
  state.revision = 3;
  await reconnect(page, state);
  await expect
    .poll(() =>
      page.evaluate(async (accountId) => {
        const opened = indexedDB.open(`neuron.collection:${accountId}`);
        const db = await new Promise<IDBDatabase>((resolve) => {
          opened.onsuccess = () => resolve(opened.result);
        });
        try {
          const read = db.transaction('meta').objectStore('meta').get('sync');
          return await new Promise<number>((resolve) => {
            read.onsuccess = () => resolve(read.result.cursor);
          });
        } finally {
          db.close();
        }
      }, owner),
    )
    .toBe(3);
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Original location');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('conflict');
  const original = (await savedCollections(page))[0]!;
  expect(original.payload.ancestors).toEqual([{ id: folderId, rev: 1 }]);
  expect(state.rows.some((row) => row.id === original.payload.entityId)).toBe(false);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Original location', exact: true });
  await expect(recovery.getByText(/Original location: Downloaded folder/)).toBeVisible();
  await recovery.getByRole('button', { name: 'Create here', exact: true }).click();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('synchronized');
  expect((await savedCollections(page))[0]?.payload.ancestors).toEqual([
    { id: target.id, rev: 2 },
    { id: folderId, rev: 3 },
  ]);
  expect((await savedCollections(page))[0]?.payload.entityId).toBe(original.payload.entityId);
});

test('local duplicate names are refused; a remote duplicate name has recoverable naming', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await createCollection(page, 'One name');
  await expect(page.getByRole('button', { name: /^One name/ })).toBeVisible();
  await createCollection(page, 'ONE NAME', 'folder');
  await expect(
    page.getByText('This name is already used here. Choose a different name or location.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await savedCollections(page)).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  state.conflict = 'name_exists';
  await reconnect(page, state);
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('conflict');
  state.conflict = undefined;
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'One name', exact: true });
  await recovery.getByLabel('Name', { exact: true }).fill('Different name');
  await recovery.getByRole('button', { name: 'Create here', exact: true }).click();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('synchronized');
  expect((await savedCollections(page))[0]?.payload.name).toBe('Different name');
});

test('duplicate identities stay retained and can only be copied or archived', async ({ page }) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await createCollection(page, 'Collision');
  state.conflict = 'identity_exists';
  await reconnect(page, state);
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('conflict');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Collision', exact: true });
  await expect(recovery.getByRole('button', { name: 'Copy the name', exact: true })).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Create here', exact: true })).toHaveCount(0);
  await recovery.getByRole('button', { name: 'Do not create it', exact: true }).click();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('resolved');
  expect((await savedCollections(page))[0]?.payload.name).toBe('Collision');
});

test('storage failure retains the name and reports no saved creation', async ({ page }) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'meta' && String(key).startsWith('deck-create:'))
        throw new DOMException('Unavailable', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await createCollection(page, 'Keep this name');
  await expect(
    page.getByText('Could not save on this device. Keep this name and try again.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveValue('Keep this name');
  expect(await savedCollections(page)).toEqual([]);
  expect(state.posted).toEqual([]);
});

test('session expiry and account switching retain the originating work without cross-account delivery', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await createCollection(page, 'Private folder', 'folder');
  const before = await savedCollections(page);
  state.expired = true;
  await reconnect(page, state);
  await expect(page).toHaveURL(/\/sign-in/);
  expect(await savedCollections(page)).toEqual(before);
  expect(state.posted).toEqual([]);
  state.expired = false;
  state.who = 'different-creator';
  // A successful explicit sign-in lifts the existing local revocation marker.
  await page.evaluate(() => localStorage.removeItem('neuron.offline.signedOut'));
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Private folder/ })).toHaveCount(0);
  expect(state.posted).toEqual([]);
  state.who = owner;
  await page.reload();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('synchronized');
  expect(state.posted.every((row) => row.accountId === owner)).toBe(true);
});

test('session expiry during creation delivery leaves the committed command for matching sign-in', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  state.expired = true;
  await createCollection(page, 'Saved before expiry');
  await expect(page).toHaveURL(/\/sign-in/);
  const before = (await savedCollections(page))[0]!;
  expect(before.state).toBe('pending');
  expect(state.posted).toEqual([before.payload]);
  state.expired = false;
  await page.evaluate(() => localStorage.removeItem('neuron.offline.signedOut'));
  await page.goto('/library');
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('synchronized');
  expect(state.posted).toEqual([before.payload, before.payload]);
});

test('an account switch during device opening cannot save or send the previous account form', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await page.evaluate((accountId) => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      const request = open.apply(this, args);
      if (args[0] === `neuron.collection:${accountId}`) {
        Object.defineProperty(request, 'onsuccess', {
          set(callback: (event: Event) => void) {
            request.addEventListener('success', (event) =>
              setTimeout(() => callback.call(request, event), 1000),
            );
          },
        });
      }
      return request;
    };
  }, owner);
  await createCollection(page, 'Previous account form');
  state.who = 'different-creator';
  await reconnect(page, state);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('neuron.offline.account')))
    .toBe(state.who);
  expect(await savedCollections(page)).toEqual([]);
  expect(state.posted).toEqual([]);
  await expect(page.getByRole('button', { name: /^Previous account form/ })).toHaveCount(0);
});

test('invalid and uncommitted acknowledgements retry the frozen command', async ({ page }) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await createCollection(page, 'Exact command');
  const saved = (await savedCollections(page))[0]!;
  state.badAck = true;
  await reconnect(page, state);
  await expect.poll(() => state.posted.length).toBeGreaterThanOrEqual(1);
  expect((await savedCollections(page))[0]?.state).toBe('pending');
  state.badAck = false;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (
        this.name === 'meta' &&
        String(key).startsWith('deck-create:') &&
        (value as { state?: string }).state === 'synchronized'
      )
        throw new DOMException('Unavailable', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await expect.poll(() => state.posted.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect((await savedCollections(page))[0]?.state).toBe('pending');
  await page.reload();
  await expect.poll(async () => (await savedCollections(page))[0]?.state).toBe('synchronized');
  expect(state.rows.filter((row) => row.id === saved.payload.entityId)).toHaveLength(1);
  expect(state.posted.every((row) => JSON.stringify(row) === JSON.stringify(saved.payload))).toBe(
    true,
  );
});

test('rebuild refuses pending creation and preserves other account-local preparation records', async ({
  page,
}) => {
  const state = await fixture(page);
  await disconnect(page, state);
  await createCollection(page, 'Protected creation');
  const before = await savedCollections(page);
  const retained = await page.evaluate(async (accountId) => {
    const opened = indexedDB.open(`neuron.collection:${accountId}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    // Opaque future records must be preserved too, rather than rewritten by recovery.
    const records = [
      ['note-create:retained', { version: 99, fields: { term: 'Unsent Note' } }],
      ['practice:retained', { version: 99, progress: ['saved step'] }],
      ['import-draft:retained', { version: 99, source: 'Unsent Import draft' }],
    ] as const;
    for (const [key, value] of records) store.put(value, key);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    return records;
  }, owner);
  state.hold = true;
  state.rows[0]!.rev = ++state.revision;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'decks') throw new DOMException('Unavailable', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await reconnect(page, state);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild offline copy', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(
    page.getByText('Sync or decide your saved changes first.', { exact: true }),
  ).toBeVisible();
  expect(await savedCollections(page)).toEqual(before);
  const after = await page.evaluate(
    async ({ accountId, keys }) => {
      const opened = indexedDB.open(`neuron.collection:${accountId}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        opened.onsuccess = () => resolve(opened.result);
      });
      try {
        const tx = db.transaction('meta');
        return await Promise.all(
          keys.map(
            (key) =>
              new Promise<unknown>((resolve) => {
                const read = tx.objectStore('meta').get(key);
                read.onsuccess = () => resolve(read.result);
              }),
          ),
        );
      } finally {
        db.close();
      }
    },
    { accountId: owner, keys: retained.map(([key]) => key) },
  );
  expect(after).toEqual(retained.map(([, value]) => value));
});
