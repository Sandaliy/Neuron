import { expect, test } from '@playwright/test';

import { manyDecks, useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * The frame rate budget, measured rather than asserted.
 *
 * Five hundred rows in the library, a phone sized viewport at two device pixels
 * per css pixel, and the processor slowed to a quarter of this machine's speed
 * through the debugger. That is the mid range profile: not a flagship, not a
 * museum piece.
 *
 * The budget is 55 frames a second. Below that the app lowers the glass on its
 * own at runtime, and this test is what stops the default from shipping under
 * the budget in the first place.
 *
 * It has already earned its place. An entrance animation left with
 * `animation-fill-mode: both` kept the container holding the five hundred rows
 * on a composited layer of its own for ever, and this scroll went from 60 frames
 * a second to 8.7. Nothing on screen looked any different.
 *
 * The measurement drives the scroll from inside `requestAnimationFrame`, so a
 * frame the compositor cannot deliver on time shows up as a longer gap between
 * callbacks, which is exactly what a person feels as a stutter.
 */

/** Frames a second the default has to hold. */
const BUDGET = 55;

/** How much slower than this machine the profile runs. */
const CPU_THROTTLE = 4;

const FRAMES = 180;

interface Measurement {
  readonly fps: number;
  readonly worst: number;
  readonly blurredRows: number;
}

async function scrollFiveHundredRows(page: Page): Promise<Measurement> {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

  // Waiting on the page being long rather than on one row: five hundred rows is
  // what is being measured, and a screen still showing its skeleton would
  // measure nothing at all.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeGreaterThan(30_000);

  await page.evaluate(() => document.fonts.ready);

  // Every entrance has to have finished, or the measurement includes them.
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });

  const blurredRows = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-g="row"]')].filter(
        (row) => getComputedStyle(row).backdropFilter !== 'none',
      ).length,
  );

  const session = await page.context().newCDPSession(page);

  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

  const frames = await page.evaluate(
    ([count]) =>
      new Promise<{ fps: number; worst: number }>((resolve) => {
        const gaps: number[] = [];

        let previous = 0;
        let offset = 0;

        const step = (now: number) => {
          gaps.push(now - previous);
          previous = now;
          offset += 24;
          window.scrollTo(0, offset);

          if (gaps.length < (count as number)) {
            requestAnimationFrame(step);

            return;
          }

          const total = gaps.reduce((sum, gap) => sum + gap, 0);

          resolve({ fps: (gaps.length / total) * 1000, worst: Math.max(...gaps) });
        };

        requestAnimationFrame((now) => {
          previous = now;
          requestAnimationFrame(step);
        });
      }),
    [FRAMES],
  );

  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await session.detach();

  return { ...frames, blurredRows };
}

function report(what: string, measured: Measurement): void {
  const line =
    `${what}: ${measured.fps.toFixed(1)} fps, worst frame ${measured.worst.toFixed(1)} ms, ` +
    `${measured.blurredRows} blurred rows`;

  // Printed rather than only asserted: the number is the answer to whether the
  // default ships, and a passing test that prints nothing cannot be read by
  // anybody deciding that.
  console.log(line);
  test.info().annotations.push({ type: 'frame rate', description: line });
}

test.describe('scroll performance', () => {
  test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

  test(`five hundred rows hold ${BUDGET} fps at the default`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');

    await usePreferences(page, {
      theme: 'dark',
      locale: 'en',
      glass: 'full',
      glassScope: 'floating',
    });
    await useFixtures(page, { decks: manyDecks(500) });

    const measured = await scrollFiveHundredRows(page);

    report(`500 rows, glass full, panels only, ${CPU_THROTTLE}x cpu`, measured);

    // The default is what the rule protects: nothing in the content flow is
    // glass, so none of the five hundred rows costs a blurred layer.
    expect(measured.blurredRows).toBe(0);
    expect(measured.fps).toBeGreaterThanOrEqual(BUDGET);
  });

  /**
   * The same list with the effect carried onto every row.
   *
   * This is a setting a person can turn on, so it is measured rather than
   * forbidden, and it is the reason the rule underneath it exists. It holds the
   * budget on this profile and falls apart on a slower one, which is what the
   * frame rate watchdog is for.
   */
  test('panels and cards is measured, and costs what it costs', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');

    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'full', glassScope: 'all' });
    await useFixtures(page, { decks: manyDecks(500) });

    const measured = await scrollFiveHundredRows(page);

    report(`500 rows, glass full, panels and cards, ${CPU_THROTTLE}x cpu`, measured);

    expect(measured.blurredRows).toBeGreaterThan(100);
  });
});
