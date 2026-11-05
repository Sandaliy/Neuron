import { appendFileSync, writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { installQualityFixture, qualityDownloaded } from './content-quality-fixture';
import { manyDecks, triageNotes, useFixtures, usePreferences } from './fixtures';
import {
  installInteractionMetrics,
  readInteractionMetrics,
  startInteractionMetrics,
} from './interaction-metrics';
import { installRecentFixture } from './recent-fixture';

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

test('Content checks retains the scroll budget and bounded downloaded reads over 6500 mixed Notes at 4x CPU', async ({
  page,
}, info) => {
  test.setTimeout(210_000);
  const state = await installQualityFixture(page);
  await installInteractionMetrics(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  try {
    await page.goto('/library/quality');
    await page.getByRole('button', { name: /^No definition / }).click();
    await expect(page.getByText('Shown: 100 of 4125', { exact: true })).toBeVisible();
    const samples: number[] = [];
    for (let trial = 0; trial < 3; trial++) {
      await page.evaluate(() => window.scrollTo(0, 0));
      samples.push(
        await page.evaluate(
          (frames) =>
            new Promise<number>((resolve) => {
              let frame = 0;
              let start = 0;
              const tick = (time: number) => {
                if (frame === 0) start = time;
                window.scrollTo(0, frame * 24);
                if (++frame >= frames) resolve(((frames - 1) * 1000) / (time - start));
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }),
          FRAMES,
        ),
      );
    }
    const fps = [...samples].sort((a, b) => a - b)[1]!;
    const mountedRows = await page.locator('[data-quality-id]').count();
    await qualityDownloaded(page);
    state.offline = true;
    await startInteractionMetrics(page);
    const started = Date.now();
    await page.evaluate(() => dispatchEvent(new Event('offline')));
    await expect(page.getByText(/^Complete downloaded collection/)).toBeVisible();
    await expect(page.getByText('Shown: 100 of 4125', { exact: true })).toBeVisible();
    const offlineMs = Date.now() - started;
    const metrics = await readInteractionMetrics(page);
    const result = {
      fps,
      samples,
      mountedRows,
      offlineMs,
      cpuSlowdown: CPU_THROTTLE,
      fixtureNotes: 6500,
      ...metrics,
    };
    // Scroll FPS excludes cold download hydration; report both measurements separately.
    result.fps = fps;
    console.info(JSON.stringify(result));
    await info.attach('content-checks-performance.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(fps).toBeGreaterThanOrEqual(BUDGET);
    expect(mountedRows).toBeLessThan(40);
    expect(offlineMs).toBeLessThan(3000);
    expect(metrics.scans['cards'] ?? 0).toBe(0);
    expect(metrics.scans['notes'] ?? 0).toBeLessThanOrEqual(1);
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});

test('Recent Notes retains bounded rows and the scroll budget over 6500 Notes at 4x CPU', async ({
  page,
}, info) => {
  const { requests } = await installRecentFixture(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  try {
    await page.goto('/notes?recent=changed');
    await expect(page.getByRole('button', { name: /^Wort 6500 word 6500/ })).toBeVisible();
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      await page.evaluate(() => window.scrollTo(0, 0));
      samples.push(
        await page.evaluate(
          (frames) =>
            new Promise<number>((resolve) => {
              let frame = 0;
              let start = 0;
              const tick = (time: number) => {
                if (frame === 0) start = time;
                window.scrollTo(0, frame * 24);
                if (++frame >= frames) resolve(((frames - 1) * 1000) / (time - start));
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }),
          FRAMES,
        ),
      );
    }
    const fps = [...samples].sort((a, b) => a - b)[1]!;
    const mountedRows = await page.locator('[data-rows] [data-row]').count();
    const result = {
      fps,
      samples,
      mountedRows,
      cpuSlowdown: CPU_THROTTLE,
      fixtureNotes: 6500,
      pageLimit: requests[0]?.searchParams.get('limit'),
    };
    console.info(JSON.stringify(result));
    await info.attach('recent-notes-performance', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(fps).toBeGreaterThanOrEqual(BUDGET);
    expect(mountedRows).toBeLessThan(40);
    expect(result.pageLimit).toBe('1000');
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});

test.describe('category browsing performance', () => {
  test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  test('Tags & Sources keeps the scroll budget with thousands of category values at 4x CPU', async ({
    page,
  }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
    await useFixtures(page);
    const values = Array.from({ length: 5000 }, (_, i) => ({
      value: `tag ${String(i).padStart(4, '0')}`,
      count: 20,
    }));
    await page.route('**/api/notes/categories?*', (route) => {
      const params = new URL(route.request().url()).searchParams;
      const all = values.filter((row) => row.value.includes(params.get('search') ?? ''));
      const after = all.filter((row) => !params.has('cursor') || row.value > params.get('cursor')!);
      const items = after.slice(0, 100);
      return route.fulfill({
        json: {
          items,
          total: all.length,
          ...(after.length > 100 ? { nextCursor: items.at(-1)!.value } : {}),
        },
      });
    });
    await page.goto('/library/categories');
    await expect(page.getByText('Shown: 100 of 5000', { exact: true })).toBeVisible();
    const radio = page.getByRole('radio', { name: 'Tags', exact: true });
    await radio.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Sources', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(radio).toBeChecked();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Show more', exact: true }).click();
      await expect(
        page.getByText(`Shown: ${(i + 2) * 100} of 5000`, { exact: true }),
      ).toBeVisible();
    }
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    const measured = await page.evaluate(async (count) => {
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const gaps: number[] = [];
      let previous = await frame();
      for (let i = 0; i < count; i++) {
        window.scrollTo(0, i * 24);
        const now = await frame();
        gaps.push(now - previous);
        previous = now;
      }
      return {
        fps: (gaps.length / gaps.reduce((a, b) => a + b, 0)) * 1000,
        worst: Math.max(...gaps),
        mounted: document.querySelectorAll('[role="listitem"]').length,
      };
    }, FRAMES);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.detach();
    console.info(
      `5000 categories, 4x CPU: ${measured.fps.toFixed(1)} fps; worst ${measured.worst.toFixed(1)} ms; ${measured.mounted} mounted rows`,
    );
    await test.info().attach('category-scroll-performance', {
      body: JSON.stringify(measured),
      contentType: 'application/json',
    });
    expect(measured.fps).toBeGreaterThanOrEqual(BUDGET);
    expect(measured.mounted).toBeLessThan(40);
  });
});

test.describe('collection search performance', () => {
  test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  test('collection search stays responsive over 5050 nested collections on a throttled phone', async ({
    page,
  }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'full', glassScope: 'all' });
    const roots = manyDecks(50).map((row, group) => ({
      ...row,
      kind: 'folder',
      name: `Folder ${group}`,
      children: manyDecks(100).map((child, at) => ({
        ...child,
        id: `child-${group}-${at}`,
        name: `Lesson ${at}`,
        parentId: row['id'],
        path: [row['id']],
      })),
    }));
    await useFixtures(page, { decks: roots, notes: [] });
    await page.goto('/library/find');
    await expect(
      page.getByRole('status').filter({ hasText: '5050 of 5050 collections' }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    const measured = await page.evaluate(async (count) => {
      const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const searches: number[] = [];
      for (const [term, expected] of [
        ['Lesson 17', 50],
        ['Folder', 50],
        ['absent', 0],
        ['Lesson 3', 550],
        ['Lesson', 5000],
      ] as const) {
        const start = performance.now();
        setter.call(input, term);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await frame();
        while (
          input.getAttribute('aria-busy') === 'true' ||
          !document
            .querySelector('[role="status"][aria-busy]')
            ?.textContent?.startsWith(`${expected} of`) ||
          (expected > 0 &&
            !document.querySelector('[role="list"] button')?.textContent?.startsWith(term))
        ) {
          if (performance.now() - start > 5000) throw new Error('Search did not finish');
          await frame();
        }
        await frame();
        searches.push(performance.now() - start);
      }
      const gaps: number[] = [];
      let previous = await frame();
      for (let at = 0; at < count; at++) {
        window.scrollTo(0, at * 24);
        const now = await frame();
        gaps.push(now - previous);
        previous = now;
      }
      return {
        searches,
        fps: (gaps.length / gaps.reduce((sum, gap) => sum + gap, 0)) * 1000,
        worst: Math.max(...gaps),
        mounted: document.querySelectorAll('[role="listitem"]').length,
      };
    }, FRAMES);
    const openMs = await page.evaluate(async () => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="list"] button')].find(
        (node) => {
          const box = node.getBoundingClientRect();
          return box.top >= 0 && box.bottom < innerHeight - 100;
        },
      )!;
      const name = button.textContent!.match(/^Lesson \d+/)![0];
      const start = performance.now();
      button.click();
      while (document.querySelector('h1')?.textContent !== name) {
        if (performance.now() - start > 5000) throw new Error('Collection did not open');
        await frame();
      }
      await frame();
      return performance.now() - start;
    });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.detach();
    const line = `5050 collections, 4x CPU: search including 150ms batching ${measured.searches.map((value) => value.toFixed(1)).join(', ')} ms; scroll ${measured.fps.toFixed(1)} fps, worst ${measured.worst.toFixed(1)} ms; ${measured.mounted} mounted rows; first Deck open ${openMs.toFixed(1)} ms`;
    console.log(line);
    await test.info().attach('collection-search-performance', {
      body: JSON.stringify({ ...measured, openMs }),
      contentType: 'application/json',
    });
    expect(Math.max(...measured.searches)).toBeLessThan(300);
    expect(measured.fps).toBeGreaterThanOrEqual(BUDGET);
    expect(measured.mounted).toBeLessThan(40);
    expect(openMs).toBeLessThan(300);
  });
});

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
