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
  return page.evaluate(
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
  const { testDatabase, createUser, repositoriesFor } =
    await import('../../api/src/db/testing/database.js');
  const { testServer } = await import('../../api/src/testing/server.js');
  const database = testDatabase();
  if (!database) throw new Error('Throwaway database required');
  const id = `offline-browser-${info.project.name}-${Date.now()}`;
  await createUser(database, id);
  const repo = repositoriesFor(database, id);
  const app = testServer(database, id);
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
  const other = repositoriesFor(database, otherId);
  const foreign = await other.decks.create({ name: 'Foreign collection' });
  const head = await repo.sync.revision();
  const cursors: number[] = [];
  const delivered: PullSyncResult[] = [];
  let interrupt = true;
  let servingAccount = id;
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
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
        const response = await (servingAccount === id ? app : testServer(database, otherId)).fetch(
          new Request(url, request),
        );
        if (response.ok) delivered.push(pullSyncResultSchema.parse(await response.clone().json()));
        return response;
      }
      return (servingAccount === id ? app : testServer(database, otherId)).fetch(request);
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
  });
  let page = await context.newPage();
  const key = (row: PullSyncResult['changes'][number]) => `${row.entity}:${row.id}`;
  const sort = (rows: PullSyncResult['changes']) =>
    [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  try {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/library');
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await page.reload();
    await expect(page.getByRole('button', { name: /Persisted Folder/ })).toBeVisible();
    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}/library`);
    await page.getByRole('button', { name: /Persisted Folder/ }).click();
    await page.getByRole('button', { name: /Migrated Deck/ }).click();
    await page.getByRole('button', { name: 'Persisted word', exact: true }).click();
    await expect(page.getByText('Persisted meaning', { exact: true })).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    const updated = await app.request(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: { term: 'Persisted word', translation: 'Reconciled meaning' },
      }),
    });
    expect(updated.status).toBe(200);
    const changedHead = await repo.sync.revision();
    server = serve({ fetch, hostname: '127.0.0.1', port: address.port });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect
      .poll(async () => (await stored(page, id))?.meta, { timeout: 30_000 })
      .toEqual({ cursor: changedHead, complete: true, format: 1 });
    const latest = pullSyncResultSchema.parse(
      await (await app.request('/api/sync?since=0&limit=200')).json(),
    );
    expect(sort((await stored(page, id))!.rows)).toEqual(sort(latest.changes));
    // A newly validated account must get its own complete snapshot, never the old projection.
    servingAccount = otherId;
    await page.reload();
    await expect
      .poll(async () => (await stored(page, otherId))?.meta, { timeout: 30_000 })
      .toEqual({ cursor: await other.sync.revision(), complete: true, format: 1 });
    expect((await stored(page, otherId))!.rows.map((row) => row.id)).toEqual([foreign.id]);
    expect(await page.evaluate(() => localStorage.getItem('neuron.offline.account'))).toBe(otherId);
  } finally {
    await context.close();
    server.close();
  }
});
