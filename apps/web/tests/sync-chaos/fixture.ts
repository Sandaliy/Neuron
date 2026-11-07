import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { expect, test as base } from '@playwright/test';

import '../../../api/src/db/testing/ws-proxy.js';
import type { PullSyncResult, SavedDeckCreation } from '@neuron/shared';
import { pullSyncResultSchema, SYNC_ENTITIES } from '@neuron/shared';

import { createRepositories } from '../../../api/src/db/repositories/index.js';
import {
  appClient,
  asUser,
  createUser,
  rawAppPool,
  testDatabase,
} from '../../../api/src/db/testing/database.js';
import { signedOutServer, testServer } from '../../../api/src/testing/server.js';
import { usePreferences as setDevicePreferences } from '../fixtures';

import { startOrigin } from './origin';

import type { RecordEvent } from './origin';
import type { PendingNoteEdit } from '../../src/lib/note-outbox';
import type { PendingReview } from '../../src/lib/review-intent';
import type { Browser, Page, TestInfo } from '@playwright/test';

export async function snapshot(page: Page, account: string) {
  return page.evaluate(
    async ({ id, entities }) => {
      const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
        const request = indexedDB.open(`neuron.collection:${id}`);
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          request.error?.name === 'AbortError' ? resolve(null) : reject(request.error);
      });
      if (!db) return null;
      try {
        const tx = db.transaction(['meta', 'outbox', 'review-outbox', ...entities]);
        const read = <T>(request: IDBRequest<T>) =>
          new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        const meta = tx.objectStore('meta');
        const [sync, edits, reviews, creations, ...rows] = await Promise.all([
          read(meta.get('sync')) as Promise<{ cursor: number; complete: boolean } | undefined>,
          read(tx.objectStore('outbox').getAll()) as Promise<PendingNoteEdit[]>,
          read(tx.objectStore('review-outbox').getAll()) as Promise<PendingReview[]>,
          read(meta.getAll(IDBKeyRange.bound('deck-create:', 'deck-create:\uffff'))) as Promise<
            SavedDeckCreation[]
          >,
          ...entities.map(
            (entity) => read(tx.objectStore(entity).getAll()) as Promise<PullSyncResult['changes']>,
          ),
        ]);
        return {
          sync,
          edits: edits.filter((entry) => entry.kind === 'note-edit'),
          reviews: reviews.sort((a, b) => a.sequence - b.sequence),
          creations,
          rows: rows.flat(),
        };
      } finally {
        db.close();
      }
    },
    { id: account, entities: [...SYNC_ENTITIES] },
  );
}

type Origin = Awaited<ReturnType<typeof startOrigin>>;

async function openDevice(browser: Browser, info: TestInfo, origin: Origin) {
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    baseURL: origin.url,
    viewport: { width: 390, height: 844 },
    isMobile: info.project.name === 'webkit',
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  return {
    context,
    origin,
    async open(path: string) {
      const page = await context.newPage();
      await setDevicePreferences(page, { locale: 'en', theme: 'dark', motion: 'reduce' });
      await page.goto(path);
      return page;
    },
  };
}

async function startLab(browser: Browser, info: TestInfo, record: RecordEvent) {
  const database = testDatabase();
  if (!database) throw new Error('Disposable test database required');
  const owner = `sync-chaos-${randomUUID()}`;
  const other = `${owner}-other`;
  await createUser(database, owner);
  await createUser(database, other);
  const client = appClient(database);
  const raw = rawAppPool(database);
  const cleanups: Array<() => Promise<unknown>> = [() => client.$client.end(), () => raw.end()];
  const close = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  };
  try {
    const repo = createRepositories(client, owner);
    const foreign = createRepositories(client, other);
    const apps = {
      owner: testServer(database, owner, client),
      other: testServer(database, other, client),
      expired: signedOutServer(database, client),
    };
    const deck = await repo.decks.create({ name: 'Chaos study deck' });
    const foreignDeck = await foreign.decks.create({ name: 'Other account deck' });
    const response = await apps.owner.request('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deckId: deck.id,
        noteType: 'basic',
        fields: { front: 'Synthetic question', back: 'Original answer' },
      }),
    });
    expect(response.status, 'synthetic Note seeded through the real API').toBe(201);
    const { note } = (await response.json()) as { note: { id: string; rev: number } };
    const [card] = await repo.cards.forNote(note.id);
    if (!card) throw new Error('Synthetic Note did not generate its Card');
    const device = async (name: 'A' | 'B') => {
      const origin = await startOrigin(name, apps, record);
      cleanups.push(() => origin.close());
      const result = await openDevice(browser, info, origin);
      cleanups.push(() => result.context.close());
      return result;
    };
    const receipts = (account: string) =>
      asUser(raw, account, async (connection) => {
        // No WHERE account filter. The restricted role must supply isolation.
        const result = await connection.query<{ fingerprint: string; status: string }>(
          `select fingerprint, coalesce(outcome #>> '{deckCreation,result,status}',
                                        outcome #>> '{noteEdit,result,status}') as status
           from sync_receipts order by fingerprint`,
        );
        return result.rows;
      });
    return { owner, other, repo, apps, note, card, foreignDeck, device, receipts, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export const test = base.extend<{
  lab: Awaited<ReturnType<typeof startLab>>;
  journal: { entries: Array<Record<string, string | number>>; record: RecordEvent };
}>({
  journal: async ({ browserName }, provide, info) => {
    const entries: Array<Record<string, string | number>> = [];
    const record: RecordEvent = (event) => entries.push({ sequence: entries.length + 1, ...event });
    try {
      await provide({ entries, record });
    } finally {
      const path = info.outputPath('sync-chaos.json');
      await writeFile(
        path,
        JSON.stringify({ scenario: info.title, browserName, entries }, null, 2),
      );
      await info.attach('sync-chaos.json', { path, contentType: 'application/json' });
    }
  },
  lab: async ({ browser, journal }, provide, info) => {
    const lab = await startLab(browser, info, journal.record);
    try {
      await provide(lab);
    } finally {
      await lab.close();
    }
  },
});

export async function converges(page: Page, id: string, app: ReturnType<typeof testServer>) {
  const response = await app.request('/api/sync?since=0&limit=200');
  expect(response.ok, 'authoritative full pull succeeded').toBe(true);
  const pull = pullSyncResultSchema.parse(await response.json());
  expect(pull.hasMore, 'synthetic dataset fits one authoritative page').toBe(false);
  const sorted = (rows: PullSyncResult['changes']) =>
    rows.toSorted((a, b) => a.entity.localeCompare(b.entity) || a.id.localeCompare(b.id));
  await expect
    .poll(async () => (await snapshot(page, id))?.sync, {
      message: 'browser cursor reaches the authoritative revision',
    })
    .toMatchObject({ complete: true, cursor: pull.revision });
  expect(
    sorted((await snapshot(page, id))!.rows),
    'every authoritative row matches IndexedDB',
  ).toEqual(sorted(pull.changes));
}

export async function connect(page: Page, origin: Origin, online: boolean) {
  origin.disconnect(!online);
  await page.evaluate((up) => window.dispatchEvent(new Event(up ? 'online' : 'offline')), online);
}

export async function warmed(page: Page, id: string) {
  await expect
    .poll(() =>
      page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)),
    )
    .toBe(true);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      message: 'built shell is controlled by its service worker',
    })
    .toBe(true);
  await expect.poll(async () => (await snapshot(page, id))?.sync?.complete).toBe(true);
}
