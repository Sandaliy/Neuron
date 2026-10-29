import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { reviewResultSchema, undoReviewResultSchema } from '@neuron/shared';

import { usePreferences } from './fixtures';

import type { PendingReview } from '../src/lib/review-outbox';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
async function events(page: Page, accountId: string) {
  return page.evaluate(async (id) => {
    const opened = indexedDB.open(`neuron.collection:${id}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    try {
      const read = db.transaction('review-outbox').objectStore('review-outbox').getAll();
      return await new Promise<PendingReview[]>((resolve) => {
        read.onsuccess = () =>
          resolve(
            read.result.sort((a: PendingReview, b: PendingReview) => a.sequence - b.sequence),
          );
      });
    } finally {
      db.close();
    }
  }, accountId);
}

// The built PWA, HTTP, PostgreSQL, RLS, planning, scheduling and receipts are real.
// Only authentication session lookup is substituted by the established test server.
test('a cold offline PWA plans new Study and reconciles committed work after reopening and a lost database response', async ({
  browser,
}, info) => {
  test.skip(
    process.env['OFFLINE_DATABASE_E2E'] !== 'true' || !process.env['CI'],
    'Requires the guarded throwaway database and built PWA.',
  );
  test.setTimeout(180_000);
  const { serve } = await import('../../api/node_modules/@hono/node-server/dist/index.mjs');
  const { testDatabase, createUser, appClient } =
    await import('../../api/src/db/testing/database.js');
  const { createRepositories } = await import('../../api/src/db/repositories/index.js');
  const { testServer } = await import('../../api/src/testing/server.js');
  const database = testDatabase();
  if (!database) throw new Error('Throwaway database required');
  const accountId = `offline-plan-pwa-${info.project.name}-${Date.now()}`;
  await createUser(database, accountId);
  const connection = appClient(database);
  const repo = createRepositories(connection, accountId);
  const app = testServer(database, accountId, connection);
  const deck = await repo.decks.create({ name: 'Cold offline Study' });
  const seeded = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckId: deck.id,
      noteType: 'basic',
      fields: { front: 'Durable question', back: 'Durable answer' },
    }),
  });
  expect(seeded.status).toBe(201);
  const { note } = await seeded.json();
  const original = (await repo.cards.forNote(note.id))[0]!;
  let lost = true;
  const deliveries: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.startsWith('/api/reviews') && request.method === 'POST') {
        deliveries.push({ path: url.pathname, body: await request.clone().json() });
        const response = await app.fetch(request);
        if (lost && response.ok) {
          lost = false;
          return Response.json(
            { error: { code: 'internal_error', status: 503, correlationId: 'lost-review-ack' } },
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
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
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
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const opened = indexedDB.open(`neuron.collection:${id}`);
          const db = await new Promise<IDBDatabase>((resolve) => {
            opened.onsuccess = () => resolve(opened.result);
          });
          const read = db.transaction('meta').objectStore('meta').get('sync');
          const complete = await new Promise<boolean>((resolve) => {
            read.onsuccess = () => resolve(read.result?.complete === true);
          });
          db.close();
          return complete;
        }, accountId),
      )
      .toBe(true);
    // A ready online Study response does not mean the background download has
    // committed. Reopening is tested only after that durable prerequisite.
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await page.close();
    page = await context.newPage();
    const coldStarted = Date.now();
    await page.goto('/');
    await expect(
      page.getByText('Available from your download. Answers save on this device.'),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    const coldEntryMs = Date.now() - coldStarted;
    expect(coldEntryMs).toBeLessThan(5000);
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await page.getByRole('button', { name: /^Easy / }).click();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
    await page.getByRole('button', { name: /^Easy / }).click();
    await expect.poll(async () => (await events(page, accountId)).length).toBe(3);
    const saved = await events(page, accountId);
    expect(deliveries).toEqual([]);
    expect(await repo.reviews.countForCards([original.id])).toBe(0);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.close();
    page = await context.newPage();
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    expect((await events(page, accountId)).map((entry) => entry.event)).toEqual(
      saved.map((entry) => entry.event),
    );
    await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
    expect((await events(page, accountId)).map((entry) => entry.event)).toEqual(
      saved.map((entry) => entry.event),
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    // A different device changes the same Card before the saved stream arrives.
    const remoteId = (await import('@neuron/shared')).uuidV7();
    await repo.reviews.record({
      id: remoteId,
      cardId: original.id,
      rating: 4,
      now: new Date(),
      durationMs: 9000,
    });
    await page.getByRole('button', { name: 'Download and capabilities', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toBeVisible();
    server = serve({ fetch, hostname: '127.0.0.1', port });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    // A healthy automatic validation resumes delivery without a manual tap.
    await expect.poll(() => deliveries.length).toBe(1);
    await expect
      .poll(async () => (await events(page, accountId))[0]?.failure)
      .toBe('internal_error');
    const finalDelivery = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/reviews' &&
        response.request().method() === 'POST' &&
        response.ok() &&
        response.request().postDataJSON().id === saved[2]!.operationId,
    );
    await page
      .getByRole('region', { name: 'Study answers' })
      .getByRole('button', { name: 'Try again', exact: true })
      .first()
      .click();
    await finalDelivery;
    await expect
      .poll(async () => (await events(page, accountId)).map((entry) => entry.state))
      .toEqual(['synchronized', 'synchronized', 'synchronized']);
    expect(deliveries.map((entry) => entry.body)).toEqual([
      saved[0]!.event.payload,
      ...saved.map((entry) => entry.event.payload),
    ]);
    const history = (await repo.sync.pull(0, 200)).changes.filter(
      (row) => row.entity === 'reviews',
    );
    expect(history).toHaveLength(4);
    expect(new Set(history.map((row) => row.id))).toEqual(
      new Set([...saved.map((entry) => entry.operationId), remoteId]),
    );
    const acknowledged = await events(page, accountId);
    const final = reviewResultSchema.parse(acknowledged[2]!.acknowledgement).card;
    const cancellation = undoReviewResultSchema.parse(acknowledged[1]!.acknowledgement);
    expect(cancellation.reviewId).toBe(saved[0]!.operationId);
    expect(cancellation.cancellationId).toBe(saved[1]!.operationId);
    expect(final.reps).toBe(2);
    expect(await repo.reviews.rebuild(original.id)).toMatchObject({
      reps: 2,
      state: final.state,
      due: new Date(final.due),
      stability: final.stability,
      learningStep: final.learningStep,
    });
    expect(await repo.reviews.countForCards([original.id])).toBe(3);
    await expect
      .poll(async () => {
        const value = await page.evaluate(
          async ({ id, cardId }) => {
            const opened = indexedDB.open(`neuron.collection:${id}`);
            const db = await new Promise<IDBDatabase>((resolve) => {
              opened.onsuccess = () => resolve(opened.result);
            });
            try {
              const tx = db.transaction(['cards', 'reviews']);
              const read = (store: string) =>
                new Promise<Array<{ id: string; row: Record<string, unknown> }>>((resolve) => {
                  const request = tx.objectStore(store).getAll();
                  request.onsuccess = () => resolve(request.result);
                });
              const [cards, reviews] = await Promise.all([read('cards'), read('reviews')]);
              return {
                card: cards.find((row) => row.id === cardId)?.row,
                count: reviews.filter((row) => row.row['cardId'] === cardId).length,
              };
            } finally {
              db.close();
            }
          },
          { id: accountId, cardId: original.id },
        );
        return { reps: value.card?.['reps'], due: value.card?.['due'], count: value.count };
      })
      .toEqual({ reps: 2, due: final.due, count: 4 });
    // Review delivery can advance the pull beyond the Me that started it.
    // Browsing completeness alone must not leave matching settings stale.
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const opened = indexedDB.open(`neuron.collection:${id}`);
          const db = await new Promise<IDBDatabase>((resolve) => {
            opened.onsuccess = () => resolve(opened.result);
          });
          try {
            const meta = db.transaction('meta').objectStore('meta');
            const get = (key: string) =>
              new Promise<Record<string, unknown>>((resolve) => {
                const read = meta.get(key);
                read.onsuccess = () => resolve(read.result);
              });
            const [account, sync] = await Promise.all([get('account'), get('sync')]);
            return sync['complete'] === true && account['revision'] === sync['cursor'];
          } finally {
            db.close();
          }
        }, accountId),
      )
      .toBe(true);
    await expect(
      page.getByText('Offline Study learning data is ready.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('offline-plan-pwa-recovery.png') });
  } finally {
    await context.close();
    server.close();
    server.closeAllConnections();
    await connection.$client.end();
  }
});
