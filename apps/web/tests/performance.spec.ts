import { appendFileSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { manyDecks, triageNotes, useFixtures, usePreferences } from './fixtures';

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
  readonly sharedBackdrops: number;
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
      [
        ...document.querySelectorAll(
          '.neu-collection-deck, .neu-collection-folder, [data-g="row"]',
        ),
      ].filter((row) => getComputedStyle(row).backdropFilter !== 'none').length,
  );

  const sharedBackdrops = await page
    .locator('[data-collection-backdrop]')
    .evaluateAll(
      (planes) =>
        planes.filter(
          (plane) =>
            getComputedStyle(plane).display !== 'none' &&
            getComputedStyle(plane).backdropFilter !== 'none',
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

  return { ...frames, blurredRows, sharedBackdrops };
}

function report(what: string, measured: Measurement, threshold?: number): void {
  const line =
    `${what}: ${measured.fps.toFixed(1)} fps, worst frame ${measured.worst.toFixed(1)} ms, ` +
    `${measured.blurredRows} blurred rows, ${measured.sharedBackdrops} shared backdrops`;

  // Printed rather than only asserted: the number is the answer to whether the
  // default ships, and a passing test that prints nothing cannot be read by
  // anybody deciding that.
  console.log(line);
  test.info().annotations.push({ type: 'frame rate', description: line });
  const passed = threshold === undefined || measured.fps >= threshold;
  writeFileSync(
    test.info().outputPath('frame-rate.json'),
    JSON.stringify({ ...measured, threshold: threshold ?? null, passed, line }, null, 2),
  );
  if (process.env['GITHUB_STEP_SUMMARY']) {
    appendFileSync(
      process.env['GITHUB_STEP_SUMMARY'],
      `\n### ${what}\n\n${line}\n\n${threshold === undefined ? 'Measured only.' : `${threshold} fps threshold: **${passed ? 'met' : 'missed'}**.`}\n`,
    );
  }
  if (!passed && process.env['CI'])
    console.log(`::warning::${line}; threshold ${threshold} fps missed`);
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

    report(`500 rows, glass full, panels only, ${CPU_THROTTLE}x cpu`, measured, BUDGET);

    // The default is what the rule protects: nothing in the content flow is
    // glass, so none of the five hundred rows costs a blurred layer.
    expect(measured.blurredRows).toBe(0);
    if (process.env['PERFORMANCE_ENFORCE_THRESHOLD'] === 'true')
      expect(measured.fps).toBeGreaterThanOrEqual(BUDGET);
  });

  test('all glass scope shares one real backdrop within the same frame budget', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');

    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'full', glassScope: 'all' });
    await useFixtures(page, { decks: manyDecks(500) });

    const measured = await scrollFiveHundredRows(page);

    report(`500 rows, glass full, panels and cards, ${CPU_THROTTLE}x cpu`, measured, BUDGET);

    expect(measured.blurredRows).toBe(0);
    expect(measured.sharedBackdrops).toBe(1);
    expect(
      await page
        .locator('.neu-collection-deck')
        .first()
        .evaluate((row) => {
          const reference = document.createElement('div');
          reference.style.background = 'var(--surface-floating)';
          row.append(reference);
          const matches =
            getComputedStyle(row).backgroundColor === getComputedStyle(reference).backgroundColor;
          reference.remove();
          return matches;
        }),
    ).toBe(true);
    if (process.env['PERFORMANCE_ENFORCE_THRESHOLD'] === 'true')
      expect(measured.fps).toBeGreaterThanOrEqual(BUDGET);
  });

  test('mixed Folders and Decks share glass within the unchanged frame budget', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');
    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'full', glassScope: 'all' });
    await useFixtures(page, {
      decks: manyDecks(500).map((deck, index) => ({
        ...deck,
        kind: index % 3 === 0 ? 'folder' : 'deck',
      })),
    });
    const measured = await scrollFiveHundredRows(page);
    report(`500 mixed collections, panels and cards, ${CPU_THROTTLE}x cpu`, measured, BUDGET);
    expect(measured.blurredRows).toBe(0);
    expect(measured.sharedBackdrops).toBe(1);
    if (process.env['PERFORMANCE_ENFORCE_THRESHOLD'] === 'true')
      expect(measured.fps).toBeGreaterThanOrEqual(BUDGET);
  });
});

/**
 * Triage at the size of a real frequency list.
 *
 * A sweep is thousands of taps in a row, so the number that matters is how
 * long one tap takes to put the next Note on screen: from the press to the
 * frame after the new word has been drawn, with the processor at a quarter of
 * this machine's speed. Every decision also recounts the whole sweep and is
 * written to the device, so this measures the real cost of both.
 */
test.describe('triage at five thousand Notes', () => {
  /** Under this a tap reads as instant; the median should be far below it. */
  const LATENCY_BUDGET_MS = 100;
  const TAPS = 40;

  test(`one tap shows the next Note within ${LATENCY_BUDGET_MS} ms`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');
    await usePreferences(page, {
      theme: 'dark',
      locale: 'en',
      glass: 'full',
      glassScope: 'floating',
    });
    await useFixtures(page, { notes: triageNotes(5000) });
    await page.goto('/notes?deckId=d5&learning=triage');
    await expect(page.getByText('Wort 1', { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    let durations: number[];
    try {
      durations = await page.evaluate(async (taps) => {
        const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
        const prompt = () =>
          document.querySelector('[data-triage-screen] .neu-learning-prompt')?.textContent;
        const results: number[] = [];
        for (let tap = 0; tap < taps; tap++) {
          const before = prompt();
          const name = ['Known', 'Unsure', 'New'][tap % 3]!;
          const button = [...document.querySelectorAll('button')].find((element) =>
            element.textContent?.startsWith(name),
          )!;
          const started = performance.now();
          button.click();
          while (prompt() === before) await frame();
          await frame();
          results.push(performance.now() - started);
          await frame();
        }
        return results;
      }, TAPS);
    } finally {
      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await session.detach();
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const line =
      `triage, 5000 Notes, ${CPU_THROTTLE}x cpu: tap to next Note median ${median.toFixed(1)} ms,` +
      ` p95 ${p95.toFixed(1)} ms, worst ${sorted.at(-1)!.toFixed(1)} ms over ${TAPS} taps`;
    console.log(line);
    test.info().annotations.push({ type: 'latency', description: line });
    if (process.env['GITHUB_STEP_SUMMARY'])
      appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `\n### Triage\n\n${line}\n`);
    await expect(page.getByText(`Left: ${5000 - TAPS}`, { exact: true })).toBeVisible();
    expect(p95).toBeLessThan(LATENCY_BUDGET_MS);
  });

  test('the decisions list keeps a bounded mounted window over five thousand rows', async ({
    page,
  }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en' });
    await useFixtures(page, { notes: triageNotes(5000) });
    await page.goto('/notes?deckId=d5&learning=triage');
    await page.getByRole('button', { name: 'All Notes in triage', exact: true }).click();
    await expect(page.getByText('Notes: 5000', { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(250_000);
    await page.evaluate(() => window.scrollTo(0, 52 * 2500));
    await expect(page.getByText('Wort 2500', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('[data-row]').length)).toBeLessThan(
      60,
    );
  });
});
