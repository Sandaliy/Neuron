import { appendFileSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { manyDecks, manyNotes, useFixtures, usePreferences } from './fixtures';
import {
  installInteractionMetrics,
  startInteractionMetrics,
  readInteractionMetrics,
} from './interaction-metrics';

/** The frame-rate budget the default note list has to hold. */
const BUDGET = 55;
const CPU_THROTTLE = 4;
const FRAMES = 180;

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

  test('Find Notes keeps 6000 Notes across 60 Decks paginated and responsive at 4x CPU', async ({
    page,
  }, info) => {
    await usePreferences(page, {
      theme: 'dark',
      locale: 'en',
      glass: 'full',
      glassScope: 'floating',
    });
    await installInteractionMetrics(page);
    const notes = manyNotes(6000).map((note, at) => ({ ...note, deckId: `deck_${at % 60}` }));
    await useFixtures(page, { decks: manyDecks(60), notes: [] });
    const requests: URL[] = [];
    await page.route('**/api/notes?*', async (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      const search = url.searchParams.get('search')?.toLowerCase();
      const matching = notes.filter(
        (note) => !search || JSON.stringify(note.fields).toLowerCase().includes(search),
      );
      await route.fulfill({
        json: {
          items: matching.slice(offset, offset + 1000),
          ...(offset + 1000 < matching.length ? { nextCursor: String(offset + 1000) } : {}),
        },
      });
    });
    await page.goto('/notes');
    await expect(page.getByRole('button', { name: /^Wort 1 word 1 · Deck 1/ })).toBeVisible();
    expect(requests).toHaveLength(1);
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    try {
      await startInteractionMetrics(page);
      const search = page.getByRole('searchbox', { name: 'Search', exact: true });
      await search.pressSequentially('word', { delay: 20 });
      await expect.poll(() => requests.at(-1)?.searchParams.get('search')).toBe('word');
      await expect(search).toBeFocused();
      await expect(search).not.toHaveAttribute('aria-busy', 'true');
      const typing = await readInteractionMetrics(page);
      expect(requests.filter((url) => url.searchParams.has('search'))).toHaveLength(1);
      expect(typing.longTasks.filter((duration) => duration > 200)).toHaveLength(0);
      await search.press('Enter');
      for (let at = 1; at < 6; at++) {
        await page.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight - innerHeight),
        );
        await expect
          .poll(() =>
            page.locator('[data-rows]').evaluate((node) => node.getBoundingClientRect().height),
          )
          .toBeGreaterThan((at + 1) * 76_000);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const samples = [];
      for (let sample = 0; sample < 3; sample++) {
        await page.evaluate(() => window.scrollTo(0, 0));
        samples.push(
          await page.evaluate(
            (count) =>
              new Promise<{ fps: number; worst: number }>((resolve) => {
                const gaps: number[] = [];
                let previous = 0;
                let offset = 0;
                const step = (now: number) => {
                  gaps.push(now - previous);
                  previous = now;
                  offset += 24;
                  window.scrollTo(0, offset);
                  if (gaps.length < count) requestAnimationFrame(step);
                  else
                    resolve({
                      fps: (gaps.length * 1000) / gaps.reduce((a, b) => a + b, 0),
                      worst: Math.max(...gaps),
                    });
                };
                requestAnimationFrame((now) => {
                  previous = now;
                  requestAnimationFrame(step);
                });
              }),
            FRAMES,
          ),
        );
      }
      const median = samples.toSorted((a, b) => a.fps - b.fps)[1]!;
      const mounted = await page.locator('[data-rows] [data-row]').count();
      const visible = await page.locator('[data-rows] [data-row]').evaluateAll((rows) =>
        rows
          .filter((row) => {
            const box = row.getBoundingClientRect();
            return box.bottom > 0 && box.top < innerHeight;
          })
          .map((row) => row.textContent),
      );
      expect(mounted).toBeLessThan(60);
      expect(visible.length).toBeGreaterThan(5);
      expect(visible.every((text) => text?.includes('Deck'))).toBe(true);
      expect(
        requests.every(
          (url) => url.searchParams.get('limit') === '1000' && !url.searchParams.has('deckId'),
        ),
      ).toBe(true);
      const evidence = {
        notes: 6000,
        decks: 60,
        cpu: CPU_THROTTLE,
        mounted,
        typing,
        samples,
        median,
        requests: requests.map((url) => url.search),
      };
      writeFileSync(
        info.outputPath('find-notes-performance.json'),
        JSON.stringify(evidence, null, 2),
      );
      console.log(
        `Find Notes: ${median.fps.toFixed(1)} fps, ${mounted} mounted rows; typing worst task ${Math.max(0, ...typing.longTasks).toFixed(1)} ms`,
      );
      await info.attach('find-notes-performance.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
      if (process.env['PERFORMANCE_ENFORCE_THRESHOLD'] === 'true')
        expect(median.fps).toBeGreaterThanOrEqual(BUDGET);
    } finally {
      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await session.detach();
    }
  });

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
