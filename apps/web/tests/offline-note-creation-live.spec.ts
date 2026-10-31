import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { openingCards, resolveDeckSettings } from '@neuron/shared';

import { usePreferences } from './fixtures';

import type { PendingNoteCreate } from '../src/lib/note-creation';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

async function creations(page: Page, accountId: string) {
  return page.evaluate(async (owner) => {
    const opened = indexedDB.open(`neuron.collection:${owner}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const read = db
        .transaction('meta')
        .objectStore('meta')
        .getAll(IDBKeyRange.bound('note-create:', 'note-create:￿'));
      return await new Promise<PendingNoteCreate[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, accountId);
}

async function complete(page: Page, accountId: string) {
  return page.evaluate(async (owner) => {
    const opened = indexedDB.open(`neuron.collection:${owner}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      if (!db.objectStoreNames.contains('meta')) return false;
      const read = db.transaction('meta').objectStore('meta').get('sync');
      return await new Promise<boolean>((resolve) => {
        read.onsuccess = () => resolve(Boolean(read.result?.complete));
        read.onerror = () => resolve(false);
      });
    } finally {
      db.close();
    }
  }, accountId);
}

test('real PostgreSQL: offline Notes survive a reopened shell, a lost answer and a deleted Deck', async ({
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
  const id = `offline-create-${info.project.name}-${Date.now()}`;
  await createUser(database, id);
  const databaseClient = appClient(database);
  const repo = createRepositories(databaseClient, id);
  const app = testServer(database, id, databaseClient);
  const words = await repo.decks.create({ name: 'Words' });
  const spare = await repo.decks.create({ name: 'Spare words' });
  const created = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckId: words.id,
      noteType: 'vocab',
      fields: { term: 'Baum', translation: 'tree' },
    }),
  });
  const existing = (await created.json()) as { note: { id: string } };
  const [answered] = await repo.cards.forNote(existing.note.id);
  await repo.reviews.record({ cardId: answered!.id, rating: 3, now: new Date() });
  const schedule = await repo.cards.forNote(existing.note.id);
  const history = await repo.reviews.forCard(answered!.id);

  let loseCreateAcknowledgement = true;
  const deliveries: Array<Record<string, unknown>> = [];
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/notes/offline-create' && request.method === 'POST') {
        deliveries.push(await request.clone().json());
        const response = await app.fetch(request);
        if (loseCreateAcknowledgement && response.ok) {
          loseCreateAcknowledgement = false;
          return Response.json(
            { error: { code: 'internal_error', status: 503, correlationId: 'lost-create-ack' } },
            { status: 503 },
          );
        }
        return response;
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
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  let page = await context.newPage();
  try {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await page.goto('/library');
    await expect.poll(() => complete(page, id), { timeout: 30_000 }).toBe(true);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await page.getByRole('button', { name: /^Words/ }).click();
    await expect(page.getByRole('button', { name: /Baum/ })).toBeVisible();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });

    const add = async (deck: RegExp, term: string, translation: string) => {
      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await page.getByRole('button', { name: deck }).click();
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      await page.getByRole('textbox', { name: 'Word', exact: true }).fill(term);
      await page.getByRole('textbox', { name: 'Translation', exact: true }).fill(translation);
      await page.getByRole('button', { name: 'Save the note', exact: true }).click();
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
      await expect(page.getByText('Saved on device', { exact: true })).toBeVisible();
    };
    await add(/^Words/, 'Haus', 'house');
    await add(/^Spare words/, 'Tür', 'door');
    const saved = await creations(page, id);
    expect(saved.map((entry) => entry.state)).toEqual(['pending', 'pending']);
    expect(deliveries).toEqual([]);

    // The installed shell reopens with no server at all.
    await page.close();
    page = await context.newPage();
    await page.goto(`${origin}/library`);
    await page.getByRole('button', { name: /^Words/ }).click();
    await expect(page.getByRole('button', { name: /Haus/ })).toBeVisible();

    // Meanwhile another device deletes the second destination.
    await repo.decks.softDelete(spare.id);
    server = serve({ fetch, hostname: '127.0.0.1', port: address.port });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'What works offline', exact: true }).click();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect
      .poll(async () => (await creations(page, id)).map((entry) => entry.state).sort(), {
        timeout: 60_000,
      })
      .toEqual(['conflict', 'synchronized']);

    const house = saved.find((entry) => entry.payload.fields['term'] === 'Haus')!;
    const door = saved.find((entry) => entry.payload.fields['term'] === 'Tür')!;
    // The lost answer was retried with the identical command and wrote one Note.
    const houseDeliveries = deliveries.filter((body) => body['noteId'] === house.entityId);
    expect(houseDeliveries.length).toBeGreaterThanOrEqual(2);
    for (const body of houseDeliveries) expect(body).toEqual(house.payload);
    const stored = await repo.notes.inDeck(words.id);
    expect(stored.map((note) => note.id).sort()).toEqual([existing.note.id, house.entityId].sort());
    const cards = await repo.cards.forNote(house.entityId);
    const planned = openingCards(
      'vocab',
      { term: 'Haus', translation: 'house' },
      resolveDeckSettings([]).ladder,
    );
    expect(cards.map(({ direction, slot }) => `${direction}:${slot}`).sort()).toEqual(
      planned.map(({ direction, slot }) => `${direction}:${slot}`).sort(),
    );
    expect(cards.every((card) => card.state === 'new' && card.reps === 0)).toBe(true);
    expect(await repo.cards.forNote(existing.note.id)).toEqual(schedule);
    expect(await repo.reviews.forCard(answered!.id)).toEqual(history);
    expect(await repo.notes.byId(door.entityId)).toBeUndefined();

    // The learner chooses where the second Note goes; it keeps its id.
    const recovery = page.getByRole('region', { name: 'New Notes saved on this device' });
    await expect(recovery.getByText('Tür', { exact: true })).toBeVisible();
    await recovery.getByRole('button', { name: 'Add it to this Deck', exact: true }).click();
    await expect
      .poll(async () => (await creations(page, id)).map((entry) => entry.state))
      .toEqual(['synchronized', 'synchronized']);
    expect((await repo.notes.byId(door.entityId))?.deckId).toBe(words.id);
    expect(await repo.cards.forNote(door.entityId)).not.toHaveLength(0);
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: /^Words/ }).click();
    await expect(page.getByRole('button', { name: /Tür/ })).toBeVisible();
    await expect(page.getByText('Saved on device', { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    server.close();
    server.closeAllConnections();
    await databaseClient.$client.end();
  }
});
