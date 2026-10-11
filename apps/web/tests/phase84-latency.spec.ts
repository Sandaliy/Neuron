import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences, reviewAcknowledgement } from './fixtures';
import { installInteractionMetrics, sampleInteraction } from './interaction-metrics';

test.use({ serviceWorkers: 'block' });
test('matched Phase 8.4 cold/warm navigation, Study transport and editor sample', async ({
  page,
  browserName,
}, info) => {
  test.skip(process.env['PHASE84_METRICS'] !== 'true', 'Controlled matched measurement only.');
  await usePreferences(page, {
    locale: 'en',
    theme: 'dark',
    glass: 'max',
    glassScope: 'panels',
    motion: 'full',
  });
  await useFixtures(page);
  await installInteractionMetrics(page);
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.route('**/api/sync?*', (route) =>
    route.fulfill({ json: { since: 0, revision: 0, hasMore: false, changes: [] } }),
  );
  const plan = page.waitForResponse('**/api/study/session');
  const coldAt = performance.now();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  const coldReadyMs = performance.now() - coldAt;
  const card: Record<string, unknown> = (await (await plan).json()).cards[0];
  const warm: number[] = [];
  const navigation = await sampleInteraction(page, async () => {
    for (let index = 0; index < 3; index++) {
      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
      const started = performance.now();
      await page.getByRole('link', { name: 'Today', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
      warm.push(performance.now() - started);
    }
  });
  const enteredAt = performance.now();
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
  const studyEntryMs = performance.now() - enteredAt;
  await page.route('**/api/reviews', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      json: {
        ...reviewAcknowledgement(route),
        card: {
          ...card,
          state: 'review',
          due: '2027-01-01T00:00:00Z',
          lastReview: route.request().postDataJSON().reviewedAt,
          stability: 8,
          difficulty: 5,
          reps: 1,
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.evaluate(() => {
    let gradedAt = 0;
    Object.assign(window, {
      reviewExitReadyMs: 0,
      reviewTransportGuardMs: 0,
      reviewLocalCommitMs: null,
    });
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      const request = add.call(this, value, key);
      if (this.name === 'review-outbox')
        this.transaction.addEventListener('complete', () => {
          Object.assign(window, { reviewLocalCommitMs: performance.now() - gradedAt });
        });
      return request;
    };
    document.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element).closest('button')?.textContent?.startsWith('Easy'))
          gradedAt = performance.now();
      },
      true,
    );
    const observer = new MutationObserver(() => {
      const exit = document.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');
      if (
        gradedAt &&
        exit &&
        !exit.disabled &&
        !(window as unknown as { reviewTransportGuardMs: number }).reviewTransportGuardMs
      )
        Object.assign(window, { reviewTransportGuardMs: performance.now() - gradedAt });
      const finish = [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Finish',
      );
      if (gradedAt && finish && !finish.disabled) {
        Object.assign(window, { reviewExitReadyMs: performance.now() - gradedAt });
        observer.disconnect();
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
  });
  let exitReadyMs = 0;
  const delivery = await sampleInteraction(page, async () => {
    const at = performance.now();
    await page.getByRole('button', { name: /^Easy / }).click();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
    exitReadyMs = performance.now() - at;
    // Extend the observation through the batched history pull, without folding
    // its duration into the independently captured exit-readiness measurement.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const started = performance.now();
          const frame = () => {
            if (performance.now() - started < 450) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        }),
    );
  });
  const exitAt = performance.now();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const studyExitMs = performance.now() - exitAt;
  const reviewTimings = await page.evaluate(() => {
    const measured = window as unknown as {
      reviewExitReadyMs: number;
      reviewTransportGuardMs: number;
      reviewLocalCommitMs: number | null;
    };
    return {
      reviewExitReadyMs: measured.reviewExitReadyMs,
      reviewTransportGuardMs: measured.reviewTransportGuardMs,
      reviewLocalCommitMs: measured.reviewLocalCommitMs,
    };
  });
  await page.goto('/notes/n1');
  const input = page.getByRole('textbox', { name: 'Translation', exact: true });
  await expect(input).toBeVisible();
  await input.focus();
  const geometry = await input.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x + window.scrollX,
      y: box.y + window.scrollY,
      width: box.width,
      height: box.height,
    };
  });
  const editor = await sampleInteraction(page, async () => {
    await input.pressSequentially(' sample', { delay: 30 });
    await expect(input).toBeFocused();
  });
  expect(
    await input.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x + window.scrollX,
        y: box.y + window.scrollY,
        width: box.width,
        height: box.height,
      };
    }),
  ).toEqual(geometry);
  const result = {
    revision: process.env['PHASE84_REVISION'],
    coldReadyMs,
    warm,
    studyEntryMs,
    exitReadyMs,
    studyExitMs,
    ...reviewTimings,
    navigation,
    delivery,
    editor,
  };
  console.info('phase84-metrics', JSON.stringify(result));
  await info.attach('phase84-metrics', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
