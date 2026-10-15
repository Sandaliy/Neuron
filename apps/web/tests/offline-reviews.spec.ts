import { expect, test } from '@playwright/test';

import {
  useFixtures as installFixtures,
  usePreferences as installPreferences,
  reviewAcknowledgement,
} from './fixtures';

import type { PendingReview } from '../src/lib/review-outbox';
import type { Page, Route } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const accountId = 'user_1';
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
async function useReviewFixture(page: Page) {
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  await installFixtures(page);
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
  const state = {
    offline: false,
    hold: undefined as Promise<void> | undefined,
    lost: false,
    bad: false,
    reject: false,
    expire: false,
    requests: [] as { path: string; body: Record<string, unknown> }[],
    card: undefined as Record<string, unknown> | undefined,
    plans: 0,
  };
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/study/session') && response.ok()) {
      state.plans++;
      state.card = (await response.json()).cards[0];
    }
  });
  await page.route('**/api/account', (route) =>
    state.offline ? route.abort('internetdisconnected') : route.fallback(),
  );
  const deliver = async (route: Route) => {
    const body = route.request().postDataJSON();
    const path = route.request().url().endsWith('/undo') ? 'undo' : 'answer';
    state.requests.push({ path, body });
    if (state.hold) await state.hold;
    if (state.offline || state.lost) {
      state.lost = false;
      return route.abort('internetdisconnected');
    }
    if (state.expire || state.reject)
      return route.fulfill({
        status: state.expire ? 401 : 404,
        json: {
          error: {
            code: state.expire ? 'not_authenticated' : 'not_found',
            status: state.expire ? 401 : 404,
            correlationId: 'review-test',
          },
        },
      });
    const card =
      path === 'undo'
        ? state.card
        : {
            ...state.card,
            state: 'review',
            stability: 8,
            difficulty: 5,
            due: '2027-01-01T00:00:00Z',
            lastReview: body.reviewedAt,
            reps: 1,
          };
    return route.fulfill({
      json: {
        ...reviewAcknowledgement(route),
        ...(state.bad ? { id: '01900000-0000-7000-8000-000000000999' } : {}),
        card,
      },
    });
  };
  await page.route('**/api/reviews', deliver);
  await page.route('**/api/reviews/undo', deliver);
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
  return state;
}
async function answer(page: Page) {
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
}
async function settings(page: Page) {
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  if (await stop.isVisible()) await stop.click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}
test('a suspended Review delivery detects loss without an account request or lifecycle event and retains the exact retry', async ({
  page,
}, info) => {
  const state = await useReviewFixture(page);
  const attempts: Record<string, unknown>[] = [];
  const holdAccount = () => undefined;
  const holdReview = (route: Route) => {
    attempts.push(route.request().postDataJSON());
  };
  await page.route('**/api/account', holdAccount);
  await page.route('**/api/reviews', holdReview);
  const at = Date.now();
  await answer(page);
  await expect.poll(() => attempts.length).toBe(1);
  const original = (await stored(page))[0]!;
  const practice = page.getByRole('button', { name: 'Practice', exact: true });
  await expect(practice).toBeEnabled();
  await expect(practice).toBeDisabled();
  const handover = Date.now() - at;
  expect(handover).toBeLessThan(5000);
  const pending = (await stored(page))[0]!;
  expect(pending.event).toEqual(original.event);
  expect(pending.operationId).toBe(original.operationId);
  expect(pending.state).toBe('pending');
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  await page.unroute('**/api/account', holdAccount);
  await page.unroute('**/api/reviews', holdReview);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.requests[0]!.body).toEqual(attempts[0]);
  await info.attach('review-transport-handover', {
    body: JSON.stringify({ handover }),
    contentType: 'application/json',
  });
});

test('local commit releases exit and Undo before delayed server acknowledgement; immutable events keep causal order', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await answer(page);
  const saved = (await stored(page))[0]!;
  expect(saved.state).toBe('pending');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Easy / })).toBeVisible();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect.poll(async () => (await stored(page)).length).toBe(3);
  const events = await stored(page);
  expect(events.map((entry) => entry.event.type)).toEqual(['answer', 'undo', 'answer']);
  expect(events[1]!.predecessor).toBe(saved.operationId);
  expect(events[2]!.predecessor).toBe(events[1]!.operationId);
  await settings(page);
  release();
  await expect
    .poll(async () => (await stored(page)).map((entry) => entry.state))
    .toEqual(['synchronized', 'synchronized', 'synchronized']);
  expect(state.requests.map((entry) => entry.path)).toEqual(['answer', 'undo', 'answer']);
  expect(state.requests.map((entry) => entry.body)).toEqual(
    events.map((entry) => entry.event.payload),
  );
});
test('an authorized sitting continues after connectivity loss; reload retains undelivered answers without restoring Undo', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await answer(page);
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  const saved = await stored(page);
  expect(saved).toHaveLength(3);
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toBeDisabled();
  expect(state.requests).toEqual([]);
  await settings(page);
  await page.reload();
  expect((await stored(page)).map((entry) => entry.event)).toEqual(
    saved.map((entry) => entry.event),
  );
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await stored(page)).every((entry) => entry.state === 'synchronized'))
    .toBe(true);
  expect(state.requests.map((entry) => entry.body)).toEqual(
    saved.map((entry) => entry.event.payload),
  );
});
test('a lost answer response followed by Undo retries the exact answer before cancellation, including after reload', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  state.lost = true;
  await answer(page);
  await expect.poll(async () => (await stored(page))[0]?.failure).toBe('network_unreachable');
  const original = (await stored(page))[0]!;
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect.poll(async () => (await stored(page)).length).toBe(2);
  await settings(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check connection', exact: true })).toBeVisible();
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await stored(page)).map((entry) => entry.state))
    .toEqual(['synchronized', 'synchronized']);
  expect(state.requests.map((entry) => entry.path)).toEqual(['answer', 'answer', 'undo']);
  expect(state.requests[0]!.body).toEqual(state.requests[1]!.body);
  expect((await stored(page))[0]!.event).toEqual(original.event);
});
for (const failure of ['quota', 'abort'] as const)
  test(`${failure} during the local transaction cannot advance or release exit; retry keeps the original event`, async ({
    page,
  }) => {
    await useReviewFixture(page);
    await page.evaluate((kind) => {
      const add = IDBObjectStore.prototype.add;
      Object.assign(window, { attemptedReview: undefined });
      IDBObjectStore.prototype.add = function (value, key) {
        if (this.name === 'review-outbox') {
          Object.assign(window, { attemptedReview: value });
          if (kind === 'quota') throw new DOMException('full', 'QuotaExceededError');
          this.transaction.abort();
        }
        return add.call(this, value, key);
      };
      Object.assign(window, {
        restoreReviewStorage: () => {
          IDBObjectStore.prototype.add = add;
        },
      });
    }, failure);
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await page.getByRole('button', { name: /^Easy / }).click();
    await expect(
      page.getByText('Answer not saved on this device. Retry before leaving Study.').first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
    expect(await stored(page)).toEqual([]);
    await page.goBack();
    await expect(page.locator('[data-learning-screen]')).toBeVisible();
    const attempt = await page.evaluate(() => {
      const w = window as unknown as {
        attemptedReview: PendingReview;
        restoreReviewStorage: () => void;
      };
      w.restoreReviewStorage();
      return w.attemptedReview;
    });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
    expect((await stored(page))[0]!.event).toEqual(attempt.event);
  });
for (const failure of ['rejected', 'malformed', 'expiry'] as const)
  test(`${failure} cannot acknowledge or discard a saved event`, async ({ page }) => {
    const state = await useReviewFixture(page);
    state.reject = failure === 'rejected';
    state.bad = failure === 'malformed';
    state.expire = failure === 'expiry';
    if (failure === 'expiry') {
      await page.getByRole('button', { name: 'Show answer', exact: true }).click();
      await page.getByRole('button', { name: /^Easy / }).click();
    } else await answer(page);
    await expect
      .poll(async () => (await stored(page))[0]?.state)
      .toBe(failure === 'rejected' ? 'rejected' : 'pending');
    if (failure === 'expiry') {
      await expect(page).toHaveURL(/sign-in/);
      state.expire = false;
      await page.evaluate(() => localStorage.removeItem('neuron.offline.signedOut'));
      await page.goto('/settings');
    } else await settings(page);
    const before = (await stored(page))[0]!.event;
    if (failure === 'rejected')
      await expect(
        page.getByText('This answer needs recovery. Later answers are kept safely on this device.'),
      ).toBeVisible();
    state.reject = false;
    state.bad = false;
    if (failure !== 'expiry')
      await page
        .getByRole('region', { name: 'Study answers' })
        .getByRole('button', { name: 'Try again', exact: true })
        .click();
    await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
    expect((await stored(page))[0]!.event).toEqual(before);
  });
test('Settings paints the simulated iPhone status area over scrolling headings', async ({
  page,
}, info) => {
  await installPreferences(page, { locale: 'en', theme: 'dark' });
  await installFixtures(page);
  await page.goto('/settings');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '47px'));
  await page.getByRole('region', { name: 'Offline & sync' }).evaluate((element) => {
    document.body.style.minHeight = '2400px';
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 12);
  });
  await expect
    .poll(() =>
      page
        .getByRole('region', { name: 'Offline & sync' })
        .evaluate((element) => Math.round(element.getBoundingClientRect().top)),
    )
    .toBe(12);
  const cover = page.locator('[data-safe-area-cover]');
  expect(await cover.boundingBox()).toMatchObject({ y: 0, height: 47 });
  expect(await cover.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  await page.screenshot({ path: info.outputPath('settings-safe-area.png') });
});

test('explicit recovery archives a rejected causal session without deleting or acknowledging any event', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  state.reject = true;
  await answer(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('rejected');
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect.poll(async () => (await stored(page)).length).toBe(2);
  const saved = await stored(page);
  await settings(page);
  await page.getByRole('button', { name: 'Keep session for recovery', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep session for recovery', exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page)).map((entry) => entry.state))
    .toEqual(['archived', 'archived']);
  expect((await stored(page)).map((entry) => entry.event)).toEqual(
    saved.map((entry) => entry.event),
  );
  await expect(
    page.getByText('Kept for recovery. These events were not synchronized.'),
  ).toHaveCount(2);
  state.reject = false;
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  expect(state.requests).toHaveLength(1);
});

test('failed acknowledgement storage retains an exact pending intent for retry', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'review-outbox' && value.state === 'synchronized')
        throw new DOMException('full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    Object.assign(window, {
      restoreAckStorage: () => {
        IDBObjectStore.prototype.put = put;
      },
    });
  });
  await answer(page);
  await expect.poll(async () => (await stored(page))[0]?.failure).toBe('invalid_acknowledgement');
  const original = (await stored(page))[0]!;
  expect(original.state).toBe('pending');
  await settings(page);
  await page.evaluate(() =>
    (window as unknown as { restoreAckStorage: () => void }).restoreAckStorage(),
  );
  await page
    .getByRole('region', { name: 'Study answers' })
    .getByRole('button', { name: 'Try again', exact: true })
    .click();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect(state.requests[0]!.body).toEqual(state.requests[1]!.body);
  expect((await stored(page))[0]!.event).toEqual(original.event);
});

test('account switching ignores a late response, isolates saved events, and resumes only the original account', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await answer(page);
  const saved = (await stored(page))[0]!;
  await expect.poll(() => state.requests.length).toBe(1);
  let who = 'user_2';
  await page.route('**/api/account', async (route) => {
    // Use the established account shape, with only the authenticated identity changed.
    return route.fulfill({
      json: {
        id: who,
        name: 'Reader',
        image: null,
        email: 'reader@example.test',
        locale: 'en',
        theme: 'dark',
        timezone: 'UTC',
        dayCutoffHour: 4,
        plan: 'free',
        settings: {},
        revision: 0,
        twoFactorEnabled: false,
      },
    });
  });
  await page.goto('/settings');
  release();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('neuron.offline.account')))
    .toBe(who);
  expect((await stored(page))[0]!.state).toBe('pending');
  await expect(page.getByRole('region', { name: 'Study answers' })).toHaveCount(0);
  who = accountId;
  state.hold = undefined;
  await page.reload();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  expect((await stored(page))[0]!.event).toEqual(saved.event);
});

test('explicit offline sign-out retains Reviews and cannot resume delivery from a still-valid cookie', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  state.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await answer(page);
  const saved = await stored(page);
  await settings(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  state.offline = false;
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(state.requests).toEqual([]);
  expect(await stored(page)).toEqual(saved);
});

test('a large synchronized history mounts only bounded optional activity and preserves every receipt', async ({
  page,
}, info) => {
  await useReviewFixture(page);
  await answer(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  await settings(page);
  const original = (await stored(page))[0]!;
  await page.evaluate(
    async ({ id, original }) => {
      const opened = indexedDB.open(`neuron.collection:${id}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        opened.onsuccess = () => resolve(opened.result);
      });
      const tx = db.transaction('review-outbox', 'readwrite');
      for (let index = 1; index <= 250; index++) {
        const operationId = `01900000-0000-7000-8000-${index.toString().padStart(12, '0')}`;
        tx.objectStore('review-outbox').put({
          ...original,
          operationId,
          sequence: original.sequence + index,
          event: { ...original.event, payload: { ...original.event.payload, id: operationId } },
          acknowledgement: { ...original.acknowledgement, id: operationId },
        });
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    { id: accountId, original },
  );
  await page.reload();
  const region = page.getByRole('region', { name: 'Study answers' });
  await expect(region.getByRole('button', { name: 'Copy recovery record' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recent activity', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Recent activity', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Study answer', exact: true })).toHaveCount(10);
  await region.getByRole('button', { name: 'Study answer', exact: true }).first().click();
  await expect(region.getByRole('button', { name: 'Copy recovery record' })).toHaveCount(1);
  await expect(region.locator('[data-moving="true"]')).toHaveCount(0);
  await region.getByRole('button', { name: 'Copy recovery record' }).scrollIntoViewIfNeeded();
  await expect(region.getByRole('button', { name: 'Copy recovery record' })).toBeInViewport();
  expect(await stored(page)).toHaveLength(251);
  await page.screenshot({ path: info.outputPath('compact-review-history.png') });
});

for (const requestUndo of [false, true])
  test(`an open local transaction explains saving and blocks exit until completion, rapid Undo=${requestUndo}`, async ({
    page,
  }) => {
    const state = await useReviewFixture(page);
    await page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      Object.assign(window, { releaseLocalCommit: false });
      IDBObjectStore.prototype.add = function (value, key) {
        const request = add.call(this, value, key);
        if (this.name === 'review-outbox') {
          const keepOpen = () => {
            const read = this.get(value.operationId);
            read.onsuccess = () => {
              if (!(window as unknown as { releaseLocalCommit: boolean }).releaseLocalCommit)
                keepOpen();
            };
          };
          keepOpen();
        }
        return request;
      };
    });
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await page.getByRole('button', { name: /^Easy / }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saving on this device' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
    expect(state.requests).toEqual([]);
    if (requestUndo)
      await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
    await page.evaluate(() => Object.assign(window, { releaseLocalCommit: true }));
    if (requestUndo) {
      await expect(page.getByRole('button', { name: /^Easy / })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
      const committed = await stored(page);
      expect(committed.map((entry) => entry.event.type)).toEqual(['answer', 'undo']);
      expect(committed[1]!.predecessor).toBe(committed[0]!.operationId);
    } else {
      await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
      expect((await stored(page)).length).toBe(1);
    }
  });

test('Undo after delivery and a lost cancellation response keeps its exact target and identity', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  await answer(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  state.lost = true;
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect.poll(async () => (await stored(page))[1]?.failure).toBe('network_unreachable');
  const saved = await stored(page);
  expect(saved[1]!.event.type).toBe('undo');
  await settings(page);
  const retry = page
    .getByRole('region', { name: 'Study answers' })
    .getByRole('button', { name: 'Try again', exact: true });
  if (await retry.isVisible()) await retry.click();
  await expect.poll(async () => (await stored(page))[1]?.state).toBe('synchronized');
  expect(state.requests.map((entry) => entry.path)).toEqual(['answer', 'undo', 'undo']);
  expect(state.requests[1]!.body).toEqual(state.requests[2]!.body);
  expect((await stored(page)).map((entry) => entry.event)).toEqual(
    saved.map((entry) => entry.event),
  );
});

test('collection rebuild retains immutable Review receipts and monotonic order for the next sitting', async ({
  page,
}) => {
  await useReviewFixture(page);
  await answer(page);
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('synchronized');
  const original = (await stored(page))[0]!;
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await settings(page);
  await page.evaluate(async (id) => {
    const opened = indexedDB.open(`neuron.collection:${id}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ cursor: 0, complete: true, format: 99 }, 'sync');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, accountId);
  await page.reload();
  await expect(
    page.getByText('The offline collection is not ready.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild downloaded collection', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild now', exact: true }).click();
  await expect(
    page.getByText('Collection downloaded for offline reading.', { exact: true }),
  ).toBeVisible();
  expect(await stored(page)).toEqual([original]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await answer(page);
  await expect.poll(async () => (await stored(page)).length).toBe(2);
  const entries = await stored(page);
  expect(entries[0]).toEqual(original);
  expect(entries[1]!.sequence).toBe(original.sequence + 1);
  expect(entries[1]!.sessionId).not.toBe(original.sessionId);
  expect(entries[1]!.predecessor).toBeNull();
});

test('a late acknowledgement after concurrent archive retains the receipt and reconciles without reopening delivery', async ({
  page,
}) => {
  const state = await useReviewFixture(page);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await answer(page);
  await expect.poll(() => state.requests.length).toBe(1);
  const original = (await stored(page))[0]!;
  await page.evaluate(async (id) => {
    const opened = indexedDB.open(`neuron.collection:${id}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const tx = db.transaction('review-outbox', 'readwrite');
    const store = tx.objectStore('review-outbox');
    const read = store.getAll();
    read.onsuccess = () =>
      store.put({ ...read.result[0], state: 'rejected', failure: 'not_found' });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    // The same account's second tab can receive a rejection while the original
    // successful response is still in flight. Broadcast no Card or Note content.
    const channel = new BroadcastChannel('neuron.reviews.changed');
    channel.postMessage({ accountId: id, saved: false });
    channel.close();
  }, accountId);
  await settings(page);
  await page.getByRole('button', { name: 'Keep session for recovery', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep session for recovery', exact: true })
    .click();
  await expect.poll(async () => (await stored(page))[0]?.state).toBe('archived');
  release();
  await expect
    .poll(async () => (await stored(page))[0]?.acknowledgement?.id)
    .toBe(original.operationId);
  const recovered = (await stored(page))[0]!;
  expect(recovered.state).toBe('archived');
  expect(recovered.event).toEqual(original.event);
  expect(recovered.acknowledgement?.card.reps).toBe(1);
  await expect(page.getByText('All saved work is synchronized.', { exact: true })).toBeVisible();
  const history = page.getByRole('region', { name: 'Study answers' });
  await expect(page.getByRole('button', { name: 'Recent activity', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Recent activity', exact: true }).click();
  await history.getByRole('button', { name: 'Study answer', exact: true }).click();
  await expect(
    page.getByText('Kept for recovery. The server confirmed this event.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  expect((await stored(page))[0]).toEqual(recovered);
  expect(state.requests).toHaveLength(1);
});
