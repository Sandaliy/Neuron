import { expect, test } from '@playwright/test';

import { manyDecks, useFixtures, usePreferences } from './fixtures';

/**
 * The frame rate budget, measured rather than asserted.
 *
 * Five hundred rows in the library, the default glass level, a phone sized
 * viewport at two device pixels per css pixel, and the processor slowed to a
 * quarter of this machine's speed through the debugger. That is the mid range
 * profile: not a flagship, not a museum piece.
 *
 * The budget is 55 frames a second. Below that the app lowers the glass on its
 * own at runtime, and this test is what stops the default from shipping under
 * the budget in the first place.
 *
 * The measurement drives the scroll from inside `requestAnimationFrame`, so a
 * frame the compositor cannot deliver on time shows up as a longer gap between
 * callbacks, which is exactly what a person feels as a stutter.
 */

/** Frames a second the default level has to hold. */
const BUDGET = 55;

/** How much slower than this machine the profile runs. */
const CPU_THROTTLE = 4;

const FRAMES = 180;

test.describe('scroll performance', () => {
  test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

  test(`five hundred rows hold ${BUDGET} fps at the default glass level`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');

    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'full' });
    await useFixtures(page, { decks: manyDecks(500) });

    await page.goto('/library');
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
    // Waiting on the page being long rather than on one row: five hundred rows
    // is what is being measured, and a screen still showing its skeleton would
    // measure nothing at all.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(30_000);
    await page.evaluate(() => document.fonts.ready);

    const session = await page.context().newCDPSession(page);

    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    const result = await page.evaluate(
      ([frames]) =>
        new Promise<{ fps: number; worst: number; blur: string }>((resolve) => {
          const gaps: number[] = [];
          const bar = document.querySelector('[data-g="tabbar"]');
          const blur = bar
            ? getComputedStyle(bar).backdropFilter || getComputedStyle(bar).webkitBackdropFilter
            : 'none';

          let previous = 0;
          let offset = 0;

          const step = (now: number) => {
            gaps.push(now - previous);
            previous = now;
            offset += 24;
            window.scrollTo(0, offset);

            if (gaps.length < (frames as number)) {
              requestAnimationFrame(step);

              return;
            }

            const total = gaps.reduce((sum, gap) => sum + gap, 0);

            resolve({
              fps: (gaps.length / total) * 1000,
              worst: Math.max(...gaps),
              blur,
            });
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

    // Printed rather than only asserted: the number is the answer to whether
    // the default ships, and a passing test that prints nothing cannot be read
    // by anybody deciding that.
    console.log(
      `500 rows, glass full, ${CPU_THROTTLE}x cpu, backdrop ${result.blur}: ` +
        `${result.fps.toFixed(1)} fps, worst frame ${result.worst.toFixed(1)} ms`,
    );

    test.info().annotations.push({
      type: 'frame rate',
      description: `${result.fps.toFixed(1)} fps over ${FRAMES} frames, worst frame ${result.worst.toFixed(1)} ms`,
    });

    expect(result.blur).toContain('blur');
    expect(result.fps).toBeGreaterThanOrEqual(BUDGET);
  });
});
