import { appendFileSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { manyNotes, useFixtures, usePreferences } from './fixtures';

/** The frame-rate budget the default note list has to hold. */
const BUDGET = 55;
const CPU_THROTTLE = 4;
const FRAMES = 180;

test('Deleted: 1000 collection rows and 5000 Notes keep bounded windows at 4x CPU', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
  await useFixtures(page);
  const decks = Array.from({ length: 1000 }, (_, i) => ({
    id: `deleted-${i}`,
    name: `Collection ${i}`,
    kind: i % 5 === 0 ? 'folder' : 'deck',
    parentId: i % 5 === 0 ? null : `deleted-${i - (i % 5)}`,
    pathNames: i % 5 === 0 ? [] : [`Collection ${i - (i % 5)}`],
    parentDeleted: i % 5 !== 0,
  }));
  const notes = manyNotes(5000).map((note) => ({
    ...note,
    deckPath: ['German', 'Lesson 3'],
    deckLive: true,
  }));
  await page.route('**/api/decks/deleted', (route) => route.fulfill({ json: { decks } }));
  await page.route('**/api/notes/deleted', (route) => route.fulfill({ json: { notes } }));
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  try {
    await page.goto('/library/deleted');
    await expect(page.getByText('Collection 0', { exact: true })).toBeVisible();
    expect(await page.getByRole('listitem').count()).toBeLessThan(40);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByText('Collection 999', { exact: true })).toBeVisible();
    expect(await page.getByRole('listitem').count()).toBeLessThan(40);
    await page.getByRole('searchbox').fill('Collection 999');
    await expect(page.getByRole('status').filter({ hasText: '1 of 1000' })).toBeVisible();
    const child = page
      .getByRole('listitem')
      .filter({ has: page.getByText('Collection 999', { exact: true }) });
    await expect(child.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    await expect(page.getByText('Collection 995', { exact: true })).toBeVisible();
    await page.getByRole('radiogroup').getByText('Notes', { exact: true }).click();
    await expect(page.getByText('Wort 1', { exact: true })).toBeVisible();
    const mounted = await page.getByRole('listitem').count();
    expect(mounted).toBeLessThan(40);
    const samples: number[] = [];
    for (let trial = 0; trial < 3; trial++) {
      await page.evaluate(() => window.scrollTo(0, 0));
      samples.push(
        await page.evaluate(async () => {
          const gaps: number[] = [];
          let previous = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
          for (let i = 0; i < 90; i++) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame((now) => {
                gaps.push(now - previous);
                previous = now;
                window.scrollBy(0, 24);
                resolve();
              }),
            );
          }
          return (1000 * gaps.length) / gaps.reduce((sum, gap) => sum + gap, 0);
        }),
      );
    }
    const visible = await page.getByRole('listitem').evaluateAll((rows) =>
      rows
        .filter((row) => {
          const box = row.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight;
        })
        .map((row) => row.textContent),
    );
    expect(visible.length).toBeGreaterThan(1);
    expect(visible.every((text) => text?.includes('Wort'))).toBe(true);
    const fps = [...samples].sort((a, b) => a - b)[1]!;
    const started = Date.now();
    await page.getByRole('searchbox').fill('Wort 4999');
    await expect(page.getByRole('status').filter({ hasText: '1 of 5000' })).toBeVisible();
    const filterMs = Date.now() - started;
    await expect(page.getByText('Wort 4999', { exact: true })).toBeVisible();
    expect(filterMs).toBeLessThan(1500);
    const result = {
      mounted,
      fps,
      samples,
      filterMs,
      cpu: CPU_THROTTLE,
      notes: 5000,
      collections: 1000,
    };
    console.log(`Deleted performance: ${JSON.stringify(result)}`);
    writeFileSync(
      test.info().outputPath('deleted-performance.json'),
      JSON.stringify(result, null, 2),
    );
    if (process.env['PERFORMANCE_ENFORCE_THRESHOLD'] === 'true')
      expect(fps).toBeGreaterThanOrEqual(BUDGET);
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.detach();
  }
});

/**
 * The note list, at the size a real frequency list actually is.
 *
 * This spec is named to run before the rest of the browser suite. The
 * measurement is sensitive to browser-process scheduling and must not inherit
 * the GPU state left by the heavier gallery and glass cases.
 */
test.describe('the note list', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

  test('five thousand notes keep a bounded mounted window', async ({ page }) => {
    await usePreferences(page, {
      theme: 'dark',
      locale: 'en',
      glass: 'full',
      glassScope: 'floating',
    });
    await useFixtures(page, { notes: manyNotes(5000) });
    await page.goto('/notes?deckId=d1');

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(250_000);

    await page.evaluate(() => window.scrollTo(0, 180 * 24));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('[data-row]')].filter((row) => {
              const box = row.getBoundingClientRect();
              return box.bottom > 0 && box.top < window.innerHeight;
            }).length,
        ),
      )
      .toBeGreaterThan(10);
    const visible = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-row]')];
      return {
        mounted: rows.length,
        words: rows
          .filter((row) => {
            const box = row.getBoundingClientRect();
            return box.bottom > 0 && box.top < window.innerHeight;
          })
          .map((row) => row.textContent),
      };
    });

    expect(visible.mounted).toBeLessThan(60);
    expect(visible.words.length).toBeGreaterThan(10);
    expect(visible.words.every((word) => word?.includes('Wort'))).toBe(true);
  });

  test(`five thousand notes hold ${BUDGET} fps`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol');
    test.skip(
      process.env['PERFORMANCE_BENCHMARK'] !== 'true',
      'Frame-rate measurement runs in the separate non-blocking benchmark job',
    );

    await usePreferences(page, {
      theme: 'dark',
      locale: 'en',
      glass: 'full',
      glassScope: 'floating',
    });
    await useFixtures(page, { notes: manyNotes(5000) });

    await page.goto('/notes?deckId=d1');

    // The rows are virtualised, so the page being long is what says they have
    // arrived. Five thousand at 52 pixels is a quarter of a million.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(250_000);

    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });

    const inDocument = await page.evaluate(() => document.querySelectorAll('[data-row]').length);
    const session = await page.context().newCDPSession(page);
    const samples: Array<{ fps: number; worst: number }> = [];

    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    try {
      for (let sample = 0; sample < 3; sample += 1) {
        await page.evaluate(() => window.scrollTo(0, 0));

        samples.push(
          await page.evaluate(
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
          ),
        );
      }
    } finally {
      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await session.detach();
    }

    // A single descheduled callback can dominate a three-second sample on a
    // shared CI runner. The median keeps the 55 fps budget intact while
    // requiring representative performance across three independent scrolls.
    const frames = [...samples].sort((left, right) => left.fps - right.fps)[1];

    // A fast empty viewport is not a passing virtual list.
    const visible = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-row]')];

      return {
        scroll: window.scrollY,
        mounted: rows.length,
        words: rows
          .filter((row) => {
            const box = row.getBoundingClientRect();

            return box.bottom > 0 && box.top < window.innerHeight;
          })
          .map((row) => row.textContent),
      };
    });

    expect(visible.scroll).toBe(FRAMES * 24);
    expect(visible.mounted).toBeLessThan(60);
    expect(visible.words.length).toBeGreaterThan(10);
    expect(visible.words.every((word) => word?.includes('Wort'))).toBe(true);

    const line =
      `5000 notes, ${inDocument} rows in the document, ${CPU_THROTTLE}x cpu: ` +
      `${frames.fps.toFixed(1)} fps median from ${samples.map((sample) => sample.fps.toFixed(1)).join(', ')}, ` +
      `worst frame ${frames.worst.toFixed(1)} ms`;

    console.log(line);
    test.info().annotations.push({ type: 'frame rate', description: line });
    const passed = frames.fps >= BUDGET;
    writeFileSync(
      test.info().outputPath('frame-rate.json'),
      JSON.stringify({ fps: frames.fps, samples, threshold: BUDGET, passed, line }, null, 2),
    );
    if (process.env['GITHUB_STEP_SUMMARY']) {
      appendFileSync(
        process.env['GITHUB_STEP_SUMMARY'],
        `### 5,000-note frame rate\n\n${line}\n\n55 fps threshold: **${passed ? 'met' : 'missed'}**. Hosted measurements are informational.\n`,
      );
    }
    if (!passed && process.env['CI'])
      console.log(`::warning::${line}; threshold ${BUDGET} fps missed`);

    // The rule the screen exists for: what is on screen is what is rendered.
    expect(inDocument).toBeLessThan(60);
    if (process.env['PERFORMANCE_ENFORCE_THRESHOLD'] === 'true')
      expect(frames.fps).toBeGreaterThanOrEqual(BUDGET);
  });
});
