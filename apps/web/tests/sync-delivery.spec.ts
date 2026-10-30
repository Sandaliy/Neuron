import { expect, test } from '@playwright/test';

import {
  useFixtures as installFixtures,
  usePreferences as installPreferences,
  reviewAcknowledgement,
} from './fixtures';

import type { PendingReview } from '../src/lib/review-outbox';
import type { Page, Route } from '@playwright/test';

declare global {
  var savingFlashes: number;
  var positions: number[];
}

/*
 * What a sitting costs to deliver.
 *
 * A phone that answered a dozen cards with no network holds a dozen immutable
 * events. Delivering them one request at a time multiplies the round trip by
 * the number of answers, and the learner waits for the product. These cases fix
 * the number of requests and the shape of the wait, so a regression that turns
 * the batch back into a queue of single posts fails here rather than on a
 * physical phone.
 */

test.use({ serviceWorkers: 'block' });
const accountId = 'user_1';

/** Round trip a phone on a mobile network actually pays per request. */
const LATENCY_MS = 120;
const ANSWERS = 12;

const DECK = '01900000-0000-7000-8000-000000000901';

function plan(count: number) {
  const at = '2026-01-01T00:00:00.000Z';
  const index = (value: number) => String(value + 1).padStart(3, '0');
  return {
    planningContext: { accountId: 'user_1', revision: 1 },
    cards: Array.from({ length: count }, (_, position) => ({
      id: `01900000-0000-7000-8000-00000000a${index(position)}`,
      noteId: `01900000-0000-7000-8000-00000000b${index(position)}`,
      deckId: DECK,
      direction: 'recognition',
      slot: 0,
      state: 'new',
      stability: null,
      difficulty: null,
      due: at,
      lastReview: null,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      suspendedAt: null,
      unlockedAt: null,
      updatedAt: at,
      rev: 1,
    })),
    notes: Array.from({ length: count }, (_, position) => ({
      id: `01900000-0000-7000-8000-00000000b${index(position)}`,
      deckId: DECK,
      noteType: 'basic',
      fields: { front: `Frage ${position + 1}`, back: `Antwort ${position + 1}` },
      tags: [],
      source: null,
      rank: null,
      status: 'active',
      importBatchId: null,
      createdAt: at,
      updatedAt: at,
      rev: 1,
    })),
    nextDue: null,
    scopeDeckIds: [DECK],
    deckSummaries: [{ deckId: DECK, due: 0, fresh: count, nextDue: null }],
    availableCount: count,
    estimatedMinutes: count * 0.1,
    budgetMinutes: 20,
    reviewCount: 0,
    newCount: count,
    backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
    newCards: {
      mode: 'automatic',
      admitted: count,
      allowed: 50,
      headroomMinutes: 20,
      marginalCost: 0.1,
      reason: 'withinBudget',
      overrideAvailable: false,
      limitedBy: null,
    },
  };
}

async function stored(page: Page, owner = accountId) {
  return page.evaluate(async (id) => {
    const opened = indexedDB.open(`neuron.collection:${id}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const read = db.transaction('review-outbox').objectStore('review-outbox').getAll();
      return await new Promise<PendingReview[]>((resolve, reject) => {
        read.onsuccess = () =>
          resolve(
            read.result.sort((a: PendingReview, b: PendingReview) => a.sequence - b.sequence),
          );
        read.onerror = () => reject(read.error);
      });
    } finally {
      db.close();
    }
  }, owner);
}

interface Delivery {
  readonly path: string;
  readonly count: number;
  readonly at: number;
}

async function useSitting(page: Page, cards = ANSWERS) {
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  await installFixtures(page);
  const state = {
    /** Held until the test releases it, so a whole sitting accumulates first. */
    hold: undefined as Promise<void> | undefined,
    /** Requests answered with a server error before delivery succeeds. */
    failures: 0,
    deliveries: [] as Delivery[],
    cards: plan(cards),
    /** Which card each delivered answer belongs to, so an Undo can name it. */
    answered: new Map<string, string>(),
  };
  await page.route('**/api/sync?*', (route) =>
    route.fulfill({
      json: {
        since: Number(new URL(route.request().url()).searchParams.get('since')),
        revision: 0,
        hasMore: false,
        changes: [],
      },
    }),
  );
  await page.route('**/api/study/session', (route) => route.fulfill({ json: state.cards }));
  const deliver = async (route: Route) => {
    const url = route.request().url();
    const body = route.request().postDataJSON();
    const path = url.endsWith('/undo') ? 'undo' : url.endsWith('/batch') ? 'batch' : 'answer';
    if (state.hold) await state.hold;
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    if (state.failures > 0) {
      state.failures -= 1;
      return route.fulfill({
        status: 503,
        json: { error: { code: 'internal', correlationId: 'test' } },
      });
    }
    state.deliveries.push({
      path,
      count: path === 'batch' ? body.reviews.length : 1,
      at: Date.now(),
    });
    const settled = (answer: Record<string, string>) => {
      const card = state.cards.cards.find((entry) => entry.id === answer['cardId']);
      state.answered.set(answer['id']!, answer['cardId']!);
      return {
        id: answer['id'],
        cardId: answer['cardId'],
        card: {
          ...card,
          state: 'review',
          stability: 8,
          difficulty: 5,
          due: '2027-01-01T00:00:00Z',
          lastReview: answer['reviewedAt'],
          reps: 1,
        },
        applied: true,
        resync: false,
        clamped: false,
      };
    };
    if (path === 'batch')
      return route.fulfill({
        json: {
          results: (body.reviews as Record<string, string>[]).map(settled),
          skipped: [],
          revision: 1,
        },
      });
    if (path === 'undo') {
      // An Undo names the Review it cancels, so the card comes from that answer.
      const cardId = state.answered.get(body.reviewId);
      return route.fulfill({
        json: {
          ...reviewAcknowledgement(route),
          card: state.cards.cards.find((entry) => entry.id === cardId),
        },
      });
    }
    return route.fulfill({ json: settled(body) });
  };
  await page.route('**/api/reviews', deliver);
  await page.route('**/api/reviews/batch', deliver);
  await page.route('**/api/reviews/undo', deliver);
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
  return state;
}

/** An undone card returns already revealed, so grading is separate from revealing. */
async function grade(page: Page) {
  await page.getByRole('button', { name: /^Easy / }).click();
}

async function answer(page: Page) {
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await grade(page);
}

test('a held sitting delivers its answers in batched requests rather than one round trip each', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const state = await useSitting(page);
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (let index = 0; index < ANSWERS; index++) await answer(page);
  await expect.poll(async () => (await stored(page)).length).toBe(ANSWERS);
  expect((await stored(page)).every((entry) => entry.state === 'pending')).toBe(true);
  const at = Date.now();
  release();
  await expect
    .poll(async () => (await stored(page)).filter((entry) => entry.state === 'pending').length, {
      timeout: 60_000,
    })
    .toBe(0);
  const elapsed = Date.now() - at;
  const requests = state.deliveries.length;
  await info.attach('review-delivery-cost', {
    body: JSON.stringify({ answers: ANSWERS, requests, elapsed, latency: LATENCY_MS }),
    contentType: 'application/json',
  });
  expect((await stored(page)).every((entry) => entry.state === 'synchronized')).toBe(true);
  // One request per answer is the regression this measures.
  expect(requests).toBeLessThanOrEqual(3);
  expect(elapsed).toBeLessThan(ANSWERS * LATENCY_MS);
});

/*
 * A request that fails without an answer used to stop delivery until the app
 * returned to the foreground or the learner pressed Retry in Settings, while
 * Today told them to go there. Delivery now tries again by itself, and Today
 * says what it is waiting for without sending anyone to Settings.
 */
test('a failed delivery retries by itself while Today explains the wait', async ({ page }) => {
  test.setTimeout(60_000);
  let release!: () => void;
  const state = await useSitting(page, 3);
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (let index = 0; index < 3; index++) await answer(page);
  await expect.poll(async () => (await stored(page)).length).toBe(3);
  state.failures = 2;
  release();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(
    page.getByText('Saved answers are waiting to be sent', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/in Settings/)).toHaveCount(0);
  // One explanation, not a second error card repeating it.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(async () => (await stored(page)).every((entry) => entry.state === 'synchronized'), {
      timeout: 30_000,
    })
    .toBe(true);
  expect(state.failures).toBe(0);
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
});

test('advancing a card while delivery runs in the background shows one clean transition', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const state = await useSitting(page);
  // Hold the first delivery open so every later answer advances while a
  // request is genuinely in flight.
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  /*
   * A flash is gone before an assertion can look for it, so the page records
   * every appearance of the saving notice as it happens.
   */
  await page.evaluate(() => {
    Object.assign(window, { savingFlashes: 0 });
    const seen = (node: Node) =>
      node instanceof HTMLElement && node.textContent?.includes('Saving on this device');
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (seen(node)) Object.assign(window, { savingFlashes: window.savingFlashes + 1 });
    }).observe(document.body, { childList: true, subtree: true });
  });
  const flashes = () => page.evaluate(() => window.savingFlashes);
  const title = page.getByRole('heading', { name: 'Study', exact: true });
  for (let index = 0; index < 4; index++) {
    const prompt = page.getByText(`Frage ${index + 1}`, { exact: true });
    await expect(prompt).toBeVisible();
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await grade(page);
    // The next card is the only thing that changes. No saving notice flashes
    // above it, and the mode title is never replaced.
    await expect(page.getByText(`Frage ${index + 2}`, { exact: true })).toBeVisible();
    await expect(title).toBeVisible();
    await expect(prompt).toHaveCount(0);
  }
  expect(await flashes()).toBe(0);
  release();
  await expect
    .poll(async () => (await stored(page)).filter((entry) => entry.state === 'pending').length, {
      timeout: 60_000,
    })
    .toBe(0);
});

test('a draining backlog settles the Settings list without rearranging the screen', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const state = await useSitting(page);
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (let index = 0; index < ANSWERS; index++) await answer(page);
  await expect.poll(async () => (await stored(page)).length).toBe(ANSWERS);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Offline & sync' }).getByText(/^Saving changes \(\d+\)…$/),
  ).toBeVisible();
  /*
   * Everything below the list is what the owner watches jump about. Sampling
   * the position of the next section says how many times the screen moved
   * while the backlog drained, which is the complaint stated as a number.
   */
  await page.evaluate(() => {
    Object.assign(window, { positions: [] as number[] });
    const sample = () => {
      window.positions.push(Math.round(document.body.getBoundingClientRect().height));
      requestAnimationFrame(sample);
    };
    sample();
  });
  release();
  await expect
    .poll(async () => (await stored(page)).filter((entry) => entry.state === 'pending').length, {
      timeout: 60_000,
    })
    .toBe(0);
  const moves = await page.evaluate(
    () => new Set(window.positions.filter((value) => Number.isFinite(value))).size,
  );
  await info.attach('settings-settle-moves', {
    body: JSON.stringify({ answers: ANSWERS, moves }),
    contentType: 'application/json',
  });
  /*
   * One settle per request, not one per answer. Delivering twelve answers
   * singly and drawing a row for each moved the page twelve times while it
   * drained; the batch and the grouped count move it four.
   */
  expect(moves).toBeLessThanOrEqual(5);
});

test('interleaved Undo keeps causal order while answers still batch', async ({ page }) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const state = await useSitting(page, 6);
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await answer(page);
  await answer(page);
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Easy / })).toBeVisible();
  await grade(page);
  await answer(page);
  await expect.poll(async () => (await stored(page)).length).toBe(5);
  expect((await stored(page)).map((entry) => entry.event.type)).toEqual([
    'answer',
    'answer',
    'undo',
    'answer',
    'answer',
  ]);
  release();
  await expect
    .poll(async () => (await stored(page)).filter((entry) => entry.state === 'pending').length, {
      timeout: 60_000,
    })
    .toBe(0);
  expect((await stored(page)).every((entry) => entry.state === 'synchronized')).toBe(true);
  /*
   * Delivery starts as soon as an answer is saved, so the first one is already
   * in flight and travels alone: an answer given with a working connection must
   * not wait for a batch to form. What follows is queued behind it, and there
   * the Undo ends the run rather than riding inside it, leaving the two answers
   * after it to travel together.
   */
  expect(state.deliveries.map((entry) => `${entry.path}:${entry.count}`)).toEqual([
    'answer:1',
    'answer:1',
    'undo:1',
    'batch:2',
  ]);
});
