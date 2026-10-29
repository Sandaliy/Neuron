import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { SYNC_ENTITIES, pullSyncResultSchema, uuidV7 } from '@neuron/shared';
import type { PullSyncResult } from '@neuron/shared';

import { usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

async function stored(page: Page, id: string) {
  const read = page.evaluate(
    async ({ id, entities }) => {
      const opened = indexedDB.open(`neuron.collection:${id}`);
      opened.onupgradeneeded = () => opened.transaction?.abort();
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => resolve(null);
      });
      if (!db) return null;
      try {
        const tx = db.transaction(['meta', ...entities]);
        const read = (store: string, key?: string) =>
          new Promise<unknown>((resolve) => {
            const request = key ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result);
          });
        const [meta, ...rows] = await Promise.all([
          read('meta', 'sync'),
          ...entities.map((entity) => read(entity)),
        ]);
        return { meta, rows: (rows as PullSyncResult['changes'][]).flat() };
      } finally {
        db.close();
      }
    },
    { id, entities: [...SYNC_ENTITIES] },
  );
  return Promise.race([
    read,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('IndexedDB snapshot read timed out')), 10_000),
    ),
  ]);
}

async function storedNoteEdits(page: Page, accountId: string) {
  return page.evaluate(async (id) => {
    const opened = indexedDB.open(`neuron.collection:${id}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    try {
      const read = db.transaction('outbox').objectStore('outbox').getAll();
      return await new Promise<
        Array<{
          operationId: string;
          entityId: string;
          state: string;
          payload: { baseRev: number; fields: Record<string, unknown> };
          base: { row: { fields: Record<string, unknown> } };
        }>
      >((resolve) => {
        read.onsuccess = () =>
          resolve(read.result.filter((entry: { kind?: string }) => entry.kind === 'note-edit'));
      });
    } finally {
      db.close();
    }
  }, accountId);
}

// Actual HTTP, authenticated collection routes, RLS/Postgres, IndexedDB and shell.
// Session lookup alone is substituted; no collection responses are mocked.
test('real persisted collection hydrates, resumes, reopens and reconciles offline', async ({
  browser,
}, info) => {
  test.skip(
    process.env['OFFLINE_DATABASE_E2E'] !== 'true',
    'Requires the guarded throwaway database',
  );
  test.skip(!process.env['CI'], 'Requires the built application shell');
  test.setTimeout(180_000);
  const { serve } = await import('../../api/node_modules/@hono/node-server/dist/index.mjs');
  const { testDatabase, createUser, appClient } =
    await import('../../api/src/db/testing/database.js');
  const { createRepositories } = await import('../../api/src/db/repositories/index.js');
  const { testServer } = await import('../../api/src/testing/server.js');
  const database = testDatabase();
  if (!database) throw new Error('Throwaway database required');
  const id = `offline-browser-${info.project.name}-${Date.now()}`;
  await createUser(database, id);
  const databaseClient = appClient(database);
  const repo = createRepositories(databaseClient, id);
  const app = testServer(database, id, databaseClient);
  // Exact identity algorithm from migration 0012. PostgreSQL accepts this UUID;
  // RFC-only UUID validation rejects its unmodified version/variant bits.
  let parentId: string;
  let digest: string;
  do {
    parentId = uuidV7();
    digest = createHash('md5').update(`collection-leaf:${parentId}`).digest('hex');
  } while (/[1-8]/.test(digest[12]!) && /[89ab]/.test(digest[16]!));
  const folder = await repo.decks.create({
    id: parentId,
    kind: 'folder',
    name: 'Persisted Folder',
  });
  const legacyId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
  const deck = await repo.decks.create({
    id: legacyId,
    name: 'Migrated Deck',
    parentId: folder.id,
  });
  const batch = await repo.importBatches.create({
    deckId: deck.id,
    source: 'Acceptance import',
    noteCount: 1,
  });
  async function createNote(noteType: string, fields: Record<string, unknown>, extra = {}) {
    const response = await app.request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deckId: deck.id, noteType, fields, ...extra }),
    });
    expect(response.status).toBe(201);
    return (await response.json()).note as { id: string };
  }
  const note = await createNote(
    'vocab',
    { term: 'Persisted word', translation: 'Persisted meaning' },
    { importBatchId: batch.id },
  );
  const syncedNote = await createNote('vocab', {
    term: 'Second word',
    translation: 'Second meaning',
  });
  const cards = await repo.cards.forNote(note.id);
  const answer = await repo.reviews.record({ cardId: cards[0]!.id, rating: 3, now: new Date() });
  await repo.reviews.undo(answer.review.id, uuidV7());
  await repo.reviews.record({ cardId: cards[0]!.id, rating: 4, now: new Date() });
  const deleted = await createNote('basic', { front: 'Deleted fact', back: 'Deleted answer' });
  await repo.notes.softDelete(deleted.id);
  const purged = await createNote('vocab', { term: 'Purged fact', translation: 'Purged answer' });
  await repo.notes.softDelete(purged.id);
  await repo.purge.remove('notes', purged.id);
  await createNote('cloze', { text: 'A {{c1::durable}} collection' });
  const preset = await repo.presets.create({ name: 'Existing preset', config: {}, deckId: null });
  await repo.presets.softDelete(preset.id);
  // Separate account data must never enter this account's pull or local stores.
  const otherId = `${id}-other`;
  await createUser(database, otherId);
  const other = createRepositories(databaseClient, otherId);
  const otherApp = testServer(database, otherId, databaseClient);
  const foreign = await other.decks.create({ name: 'Foreign collection' });
  const head = await repo.sync.revision();
  const cursors: number[] = [];
  const delivered: PullSyncResult[] = [];
  let interrupt = true;
  let servingAccount = id;
  let loseRenameAcknowledgement = true;
  let loseNoteAcknowledgement = true;
  const renameDeliveries: unknown[] = [];
  const noteDeliveries: Array<{ operationId: string; fields: Record<string, unknown> }> = [];
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.endsWith('/rename') && request.method === 'POST') {
        renameDeliveries.push(await request.clone().json());
        const response = await app.fetch(request);
        if (loseRenameAcknowledgement && response.ok) {
          loseRenameAcknowledgement = false;
          return Response.json(
            { error: { code: 'internal_error', status: 503, correlationId: 'lost-ack' } },
            { status: 503 },
          );
        }
        return response;
      }
      if (url.pathname.endsWith('/offline-edit') && request.method === 'POST') {
        const body = (await request.clone().json()) as {
          operationId: string;
          fields: Record<string, unknown>;
        };
        noteDeliveries.push(body);
        const response = await app.fetch(request);
        if (loseNoteAcknowledgement && url.pathname.includes(syncedNote.id) && response.ok) {
          loseNoteAcknowledgement = false;
          return Response.json(
            { error: { code: 'internal_error', status: 503, correlationId: 'lost-note-ack' } },
            { status: 503 },
          );
        }
        return response;
      }
      if (url.pathname === '/api/sync') {
        const since = Number(url.searchParams.get('since'));
        cursors.push(since);
        if (since > 0 && interrupt)
          return Response.json(
            { error: { code: 'internal_error', status: 503, correlationId: 'injected-transient' } },
            { status: 503 },
          );
        // Exercise real revision-boundary pagination with a deliberately small page.
        url.searchParams.set('limit', '2');
        const response = await (servingAccount === id ? app : otherApp).fetch(
          new Request(url, request),
        );
        if (response.ok) delivered.push(pullSyncResultSchema.parse(await response.clone().json()));
        return response;
      }
      return (servingAccount === id ? app : otherApp).fetch(request);
    }
    const asset =
      url.pathname.startsWith('/assets/') ||
      ['/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(
        url.pathname,
      )
        ? url.pathname.slice(1)
        : 'index.html';
    const type = asset.endsWith('.js')
      ? 'application/javascript'
      : asset.endsWith('.css')
        ? 'text/css'
        : asset.endsWith('.png')
          ? 'image/png'
          : asset.endsWith('.svg')
            ? 'image/svg+xml'
            : asset.endsWith('.webmanifest')
              ? 'application/manifest+json'
              : 'text/html';
    try {
      return new Response(await readFile(path.join(process.cwd(), 'dist', asset)), {
        headers: { 'content-type': type },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  let server = serve({ fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    baseURL: origin,
    viewport: info.project.use.viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  let page = await context.newPage();
  const key = (row: PullSyncResult['changes'][number]) => `${row.entity}:${row.id}`;
  const sort = (rows: PullSyncResult['changes']) =>
    [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  try {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    const firstPull = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/sync' && url.searchParams.get('since') === '0';
    });
    await page.goto('/library');
    expect((await firstPull).status()).toBe(200);
    await expect.poll(() => cursors.length).toBe(2);
    const boundary = delivered[0]!.revision;
    expect((await stored(page, id))?.meta).toEqual({
      cursor: boundary,
      complete: false,
      format: 1,
    });
    const header = page.getByRole('heading', { name: 'Library', exact: true });
    await expect(header).toBeVisible();
    const top = (await header.boundingBox())!.y;
    await expect(page.getByText('The offline collection is not ready.')).toHaveCount(0);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByText('You can keep using Neuron online.', { exact: true }),
    ).toBeVisible();
    interrupt = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect
      .poll(async () => (await stored(page, id))?.meta, { timeout: 30_000 })
      .toEqual({ cursor: head, complete: true, format: 1 });
    expect(cursors[2]).toBe(boundary);
    expect(cursors.filter((cursor) => cursor === 0)).toHaveLength(1);
    const whole = pullSyncResultSchema.parse(
      await (await app.request('/api/sync?since=0&limit=200')).json(),
    );
    const persisted = (await stored(page, id))!;
    expect(sort(persisted.rows)).toEqual(sort(whole.changes));
    expect(persisted.rows.some((row) => row.id === foreign.id)).toBe(false);
    expect(new Set(persisted.rows.map((row) => row.entity))).toEqual(new Set(SYNC_ENTITIES));
    expect(persisted.rows.some((row) => row.purged)).toBe(true);
    expect(persisted.rows.filter((row) => row.entity === 'reviews')).toHaveLength(3);
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    expect((await header.boundingBox())!.y).toBe(top);
    // Deliberately corrupted read-only metadata; recovery starts from zero only on confirmation.
    await page.evaluate(async (id) => {
      const request = indexedDB.open(`neuron.collection:${id}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ cursor: 0, complete: true, format: 99 }, 'sync');
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, id);
    await page.reload();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByText(/offline storage could not be opened or read/)).toBeVisible();
    await page.getByRole('button', { name: 'Rebuild downloaded collection', exact: true }).click();
    expect(cursors.filter((cursor) => cursor === 0)).toHaveLength(1);
    await page.getByRole('button', { name: 'Rebuild now', exact: true }).click();
    await expect
      .poll(async () => (await stored(page, id))?.meta, { timeout: 30_000 })
      .toEqual({ cursor: head, complete: true, format: 1 });
    expect(sort((await stored(page, id))!.rows)).toEqual(sort(whole.changes));
    expect(cursors.filter((cursor) => cursor === 0)).toHaveLength(2);
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await page.getByRole('button', { name: /^Persisted Folder/ }).click();
    await page.getByRole('button', { name: /^Migrated Deck/ }).click();
    await page.getByRole('searchbox').fill('Persisted');
    await expect(page.getByRole('searchbox')).not.toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByRole('button', { name: /Persisted word Persisted meaning/ }),
    ).toBeVisible();
    await page
      .locator('main section[data-screen]')
      .evaluate((element) => element.setAttribute('data-live-visit', 'retained'));
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    // Actual GET transport loss, with browser hints still online and no reload.
    const failedAccount = page.waitForEvent(
      'requestfailed',
      (request) => new URL(request.url()).pathname === '/api/account',
    );
    await page.getByRole('searchbox').fill('Persisted word');
    await failedAccount;
    await expect(page.getByText('Offline', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.locator('[data-live-visit="retained"]')).toHaveCount(1);
    await page.getByRole('button', { name: /Persisted word Persisted meaning/ }).click();
    await expect(page.getByRole('textbox', { name: 'Translation' })).toHaveValue(
      'Persisted meaning',
    );
    await page.getByRole('textbox', { name: 'Translation' }).fill('Local first meaning');
    await expect(page.getByText('Saved on device', { exact: true })).toBeVisible();
    const firstEdit = (await storedNoteEdits(page, id)).find(
      (entry) => entry.entityId === note.id,
    )!;
    await page.getByRole('textbox', { name: 'Translation' }).fill('Local losing meaning');
    await expect(page.getByText('Saved on device', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await storedNoteEdits(page, id)).find((entry) => entry.entityId === note.id)?.payload
            .fields.translation,
      )
      .toBe('Local losing meaning');
    const revisedEdit = (await storedNoteEdits(page, id)).filter(
      (entry) => entry.entityId === note.id,
    );
    expect(revisedEdit).toHaveLength(1);
    expect(revisedEdit[0]?.operationId).toBe(firstEdit.operationId);
    expect(revisedEdit[0]?.payload.baseRev).toBe(firstEdit.payload.baseRev);
    expect(revisedEdit[0]?.base.row.fields).toMatchObject({ translation: 'Persisted meaning' });
    expect(revisedEdit[0]?.payload.fields).toMatchObject({ translation: 'Local losing meaning' });
    await page.reload();
    await expect(page.getByRole('button', { name: /^Persisted Folder/ })).toBeVisible();
    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}/library`);
    await page.getByRole('button', { name: /^Persisted Folder/ }).click();
    await page.getByRole('button', { name: /^Migrated Deck/ }).click();
    await page.getByRole('button', { name: /Persisted word/ }).click();
    await expect(page.getByRole('textbox', { name: 'Translation' })).toHaveValue(
      'Local losing meaning',
    );
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: /^Persisted Folder/ }).click();
    await page.getByRole('button', { name: /^Migrated Deck/ }).click();
    await page.getByRole('button', { name: /Second word/ }).click();
    await page.getByRole('textbox', { name: 'Translation' }).fill('Local synchronized meaning');
    await expect(page.getByText('Saved on device', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Translation' })).toHaveValue(
      'Local synchronized meaning',
    );
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: /^Persisted Folder/ }).click();
    await page.getByRole('button', { name: 'Actions for Migrated Deck', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox').fill('Durably renamed Deck');
    await page.getByRole('button', { name: 'Save the name', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Durably renamed Deck/ })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^Persisted Folder/ }).click();
    await expect(page.getByRole('button', { name: /^Durably renamed Deck/ })).toBeVisible();
    const updated = await app.request(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: { term: 'Persisted word', translation: 'Reconciled meaning' },
      }),
    });
    expect(updated.status).toBe(200);
    server = serve({ fetch, hostname: '127.0.0.1', port: address.port });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Offline details', exact: true }).click();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect.poll(() => noteDeliveries.length).toBe(2);
    await page
      .getByRole('region', { name: 'Saved Note edits' })
      .getByRole('button', { name: 'Try again', exact: true })
      .click();
    await expect.poll(() => noteDeliveries.length).toBe(3);
    expect(
      noteDeliveries.filter((entry) => entry.fields.translation === 'Local synchronized meaning'),
    ).toHaveLength(2);
    expect((await repo.notes.byId(syncedNote.id))?.fields).toMatchObject({
      translation: 'Local synchronized meaning',
    });
    expect((await repo.notes.byId(note.id))?.fields).toMatchObject({
      translation: 'Reconciled meaning',
    });
    await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
    // Each recovery panel retries its own preserved command after a lost acknowledgement.
    await page
      .getByRole('region', { name: 'Saved name changes' })
      .getByRole('button', { name: 'Try again', exact: true })
      .click();
    await expect.poll(() => renameDeliveries.length).toBe(2);
    const savedNames = page.getByRole('region', { name: 'Saved name changes' });
    await page.getByRole('button', { name: 'Recent activity', exact: true }).click();
    await savedNames.getByRole('button', { name: 'Durably renamed Deck', exact: true }).click();
    await expect(
      savedNames.getByText('Synchronized with the server', { exact: true }),
    ).toBeVisible();
    expect(renameDeliveries).toHaveLength(2);
    expect(renameDeliveries[0]).toEqual(renameDeliveries[1]);
    expect((await repo.decks.byId(deck.id))?.name).toBe('Durably renamed Deck');
    const changedHead = await repo.sync.revision();
    await expect
      .poll(
        async () => {
          const snapshot = await Promise.race([
            stored(page, id),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('snapshot read timeout')), 10_000),
            ),
          ]);
          return snapshot?.meta;
        },
        { timeout: 30_000 },
      )
      .toMatchObject({ cursor: changedHead, complete: true, format: 1 });
    const latest = pullSyncResultSchema.parse(
      await (await app.request('/api/sync?since=0&limit=200')).json(),
    );
    expect(sort((await stored(page, id))!.rows)).toEqual(sort(latest.changes));
    // A newly validated account must get its own complete snapshot, never the old projection.
    servingAccount = otherId;
    await page.reload();
    const otherRevision = await Promise.race([
      other.sync.revision(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('other revision timeout')), 10_000),
      ),
    ]);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('neuron.offline.account')), {
        timeout: 30_000,
      })
      .toBe(otherId);
    let otherSnapshot: Awaited<ReturnType<typeof stored>> = null;
    await expect
      .poll(
        async () => {
          const saved = await stored(page, otherId);
          if (saved?.meta) otherSnapshot = saved;
          return saved?.meta;
        },
        { timeout: 30_000 },
      )
      .toMatchObject({ cursor: otherRevision, complete: true, format: 1 });
    expect(otherSnapshot!.rows.map((row) => row.id)).toEqual([foreign.id]);
    expect(await page.evaluate(() => localStorage.getItem('neuron.offline.account'))).toBe(otherId);
  } finally {
    await context.close();
    server.close();
    server.closeAllConnections();
    await databaseClient.$client.end();
  }
});
