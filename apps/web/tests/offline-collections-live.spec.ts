import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import type { SavedDeckCreation } from '@neuron/shared';

import { chooseDeckLanguages, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

async function saved(page: Page, accountId: string) {
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

test('real PostgreSQL and cached PWA: offline collections reopen, retry exactly and recover a removed parent', async ({
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
  const accountId = `collection-pwa-${info.project.name}-${Date.now()}`;
  await createUser(database, accountId);
  const client = appClient(database);
  const repo = createRepositories(client, accountId);
  const app = testServer(database, accountId, client);
  const parent = await repo.decks.create({
    kind: 'folder',
    name: 'Original folder',
    settings: { targetLanguage: 'de' },
  });
  const existing = await repo.decks.create({ name: 'Existing deck' });
  const response = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckId: existing.id,
      noteType: 'vocab',
      fields: { term: 'Baum', translation: 'tree' },
    }),
  });
  const { note } = (await response.json()) as { note: { id: string } };
  const [card] = await repo.cards.forNote(note.id);
  await repo.reviews.record({ cardId: card!.id, rating: 3, now: new Date() });
  const cards = await repo.cards.forNote(note.id);
  const history = await repo.reviews.forCard(card!.id);

  let lose = true;
  const deliveries: Record<string, unknown>[] = [];
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/decks/offline-create' && request.method === 'POST') {
        deliveries.push(await request.clone().json());
        const result = await app.fetch(request);
        if (lose && result.ok) {
          lose = false;
          return Response.json(
            { error: { code: 'internal_error', status: 503, correlationId: 'lost-creation' } },
            { status: 503 },
          );
        }
        return result;
      }
      return app.fetch(request);
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
    isMobile: true,
    hasTouch: true,
  });
  let page = await context.newPage();
  try {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'What works offline', exact: true }).click();
    await expect(
      page.getByText('Your collection is downloaded to this device.', { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
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
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    const create = async (name: string, kind: 'folder' | 'deck') => {
      await page
        .getByRole('button', { name: kind === 'folder' ? 'New folder' : 'New deck', exact: true })
        .click();
      await page.getByRole('dialog').getByRole('textbox', { name: 'Name', exact: true }).fill(name);
      if (kind === 'deck') await chooseDeckLanguages(page.getByRole('dialog'));
      await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    };
    await create('Offline folder', 'folder');
    await page.getByRole('button', { name: /^Original folder/ }).click();
    await create('Offline deck', 'deck');
    const before = await saved(page, accountId);
    expect(before.map((entry) => entry.state)).toEqual(['pending', 'pending']);
    expect(deliveries).toEqual([]);

    // Close the page and launch the cached shell while the HTTP origin is stopped.
    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}/library`);
    await expect(page.getByRole('button', { name: /^Offline folder/ })).toBeVisible();
    await page.getByRole('button', { name: /^Original folder/ }).click();
    await expect(page.getByRole('button', { name: /^Offline deck/ })).toBeVisible();
    expect(await saved(page, accountId)).toEqual(before);

    await repo.decks.softDelete(parent.id);
    server = serve({ fetch, hostname: '127.0.0.1', port: address.port });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'What works offline', exact: true }).click();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect
      .poll(async () => (await saved(page, accountId)).map((entry) => entry.state).sort(), {
        timeout: 60_000,
      })
      .toEqual(['conflict', 'synchronized']);
    const folder = before.find((entry) => entry.payload.kind === 'folder')!;
    const deck = before.find((entry) => entry.payload.kind === 'deck')!;
    expect(
      deliveries.filter((row) => row['entityId'] === folder.payload.entityId).length,
    ).toBeGreaterThanOrEqual(2);
    for (const body of deliveries.filter((row) => row['entityId'] === folder.payload.entityId))
      expect(body).toEqual(folder.payload);
    expect(
      (await repo.decks.list()).filter((row) => row.id === folder.payload.entityId),
    ).toHaveLength(1);
    expect(await repo.decks.byId(deck.payload.entityId)).toBeUndefined();
    const recovery = page.getByRole('region', { name: 'Offline deck', exact: true });
    await recovery.getByLabel('Create inside', { exact: true }).selectOption('');
    await recovery.getByRole('button', { name: 'Create here', exact: true }).click();
    await expect
      .poll(async () => (await saved(page, accountId)).map((entry) => entry.state), {
        timeout: 30_000,
      })
      .toEqual(['synchronized', 'synchronized']);
    expect((await repo.decks.byId(deck.payload.entityId))?.parentId).toBeNull();
    expect(await repo.cards.forNote(note.id)).toEqual(cards);
    expect(await repo.reviews.forCard(card!.id)).toEqual(history);
    expect((await repo.notes.inDeck(existing.id)).map((row) => row.id)).toEqual([note.id]);
  } finally {
    await context.close();
    server.close();
    server.closeAllConnections();
    await client.$client.end();
  }
});
