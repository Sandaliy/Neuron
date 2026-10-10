import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

const stamp = '2026-01-01T00:00:00Z';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const decks = ['de', 'en'].map((language, index) => ({
  id: id(index + 1),
  name: language === 'de' ? 'German' : 'English',
  kind: 'deck',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 1,
  position: index,
  settings: { targetLanguage: language },
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
}));
const notes = decks.map((deck, index) => ({
  id: id(index + 10),
  deckId: deck.id,
  noteType: 'vocab',
  fields: { term: index ? 'care' : 'Sorgfalt', translation: 'meaning', definition: 'support' },
  tags: [],
  status: 'active',
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
}));

test('configuration and Deck entry probe separates control feedback from authoritative readiness', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
  await useFixtures(page, { decks, notes });
  // A cold screen module must overlap its data read, rather than suspending
  // the committed Deck screen and adding a fallback/commit delay.
  let moduleReleasedAt: number | undefined;
  await page.route('**/assets/note-list-*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    moduleReleasedAt = performance.now();
    await route.continue();
  });
  await page.route('**/api/decks/*/practice', (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  const requests: { path: string; at: number; body?: unknown }[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ path, at: performance.now(), body: route.request().postDataJSON() });
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!path.endsWith('/study/session')) return route.fallback();
    const body = route.request().postDataJSON();
    const index = body.targetLanguage === 'en' ? 1 : 0;
    const card = {
      id: id(index + 20),
      noteId: notes[index]!.id,
      deckId: decks[index]!.id,
      direction: body.direction ?? 'recognition',
      slot: 0,
      state: 'new',
      due: stamp,
      stability: null,
      difficulty: null,
      lastReview: null,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      suspendedAt: null,
      unlockedAt: stamp,
      updatedAt: stamp,
      rev: 1,
    };
    return route.fulfill({
      json: {
        planningContext: { accountId: 'user_1', revision: 42 },
        targetLanguage: index ? 'en' : 'de',
        languages: ['de', 'en'],
        aggregateReady: 2,
        cards: [card],
        notes: [notes[index]],
        scopeDeckIds: [decks[index]!.id],
        deckSummaries: [{ deckId: decks[index]!.id, due: 0, fresh: 1, nextDue: null }],
        nextDue: null,
        availableCount: 1,
        estimatedMinutes: 1,
        budgetMinutes: 20,
        reviewCount: 0,
        newCount: 1,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: 1,
          allowed: 2,
          headroomMinutes: 20,
          marginalCost: 1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    });
  });
  const start = performance.now();
  await page.goto('/');
  const study = page.getByRole('button', { name: 'Study', exact: true });
  await expect(study).toBeEnabled();
  const firstReadyMs = performance.now() - start;
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  const configurations: { name: string; feedbackMs: number; readyMs: number }[] = [];
  for (const [name, value] of [
    ['Study language', 'en'],
    ['Study mode', 'production'],
    ['Time for this session', '10'],
  ]) {
    const at = performance.now();
    const control = page.getByRole('combobox', { name, exact: true });
    await control.selectOption(value!);
    await expect(control).toHaveValue(value!);
    const feedbackMs = performance.now() - at;
    await expect(study).toBeEnabled();
    configurations.push({ name: name!, feedbackMs, readyMs: performance.now() - at });
  }
  const planReads = requests.filter((request) => request.path.endsWith('/study/session')).length;
  const localAt = performance.now();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).click();
  await expect(study).toBeEnabled();
  const displayMs = performance.now() - localAt;
  expect(requests.filter((request) => request.path.endsWith('/study/session'))).toHaveLength(
    planReads,
  );
  const libraryAt = performance.now();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  const libraryEntryMs = performance.now() - libraryAt;
  const entries: number[] = [];
  for (let visit = 0; visit < 2; visit++) {
    const at = performance.now();
    await page.getByRole('button', { name: 'German', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'German', exact: true })).toBeVisible();
    await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
    entries.push(performance.now() - at);
    if (visit === 0 && process.env['CI']) {
      expect(moduleReleasedAt).toBeDefined();
      for (const path of ['/api/notes', `/api/decks/${decks[0]!.id}/practice`])
        expect(requests.find((request) => request.path === path)!.at).toBeLessThan(
          moduleReleasedAt!,
        );
    }
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  }
  const settingsAt = performance.now();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const settingsEntryMs = performance.now() - settingsAt;
  const result = {
    transportMs: 250,
    firstReadyMs,
    configurations,
    displayMs,
    libraryEntryMs,
    settingsEntryMs,
    deckEntryMs: entries,
    requests,
  };
  console.info('polish-latency', JSON.stringify(result));
  await info.attach('configuration-latency', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
});

for (const theme of ['light', 'dark'] as const)
  test(`Study controls keep complete focus halos at narrow widths, ${theme}`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme, glass: 'full', glassScope: 'all' });
    await useFixtures(page, { decks, notes });
    await page.goto('/');
    const setup = page.getByRole('button', { name: 'Study setup', exact: true });
    await setup.click();
    const content = page.locator(`#${await setup.getAttribute('aria-controls')}`);
    await expect(content).toHaveCSS('overflow', 'visible');
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 });
      for (const name of ['Study language', 'Time for this session', 'Study mode']) {
        const control = page.getByRole('combobox', { name, exact: true });
        await control.focus();
        const clipped = await control.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const result: string[] = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (!/(hidden|clip|auto|scroll)/.test(style.overflowX)) continue;
            const bounds = parent.getBoundingClientRect();
            if (box.left - 5 < bounds.left || box.right + 5 > bounds.right)
              result.push(parent.className);
          }
          return result;
        });
        expect(clipped).toEqual([]);
        await expect(control).toHaveCSS('outline-style', 'solid');
      }
      await page.screenshot({ path: info.outputPath(`focus-${theme}-${width}.png`) });
    }
  });

test('a pending replacement cannot block or overwrite a compatible confirmed configuration', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks, notes });
  let requested = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/study/session', async (route) => {
    if (route.request().postDataJSON().targetLanguage === 'en') {
      requested = true;
      await held;
    }
    await route.fallback();
  });
  await page.goto('/');
  const study = page.getByRole('button', { name: 'Study', exact: true });
  await expect(study).toBeEnabled();
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  const language = page.getByRole('combobox', { name: 'Study language', exact: true });
  await language.selectOption('en');
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByText('Updating plan…', { exact: true }).first()).toBeVisible();
  await expect(study).not.toBeVisible();
  await language.selectOption('de');
  await expect(study).toBeEnabled();
  release();
  await expect(language).toHaveValue('de');
  await expect(study).toBeEnabled();
});

test('Study disclosure stays continuous through asynchronous configuration and repeated reversals', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'full', glassScope: 'all' });
  await useFixtures(page, {
    decks: decks.map((deck) => ({
      ...deck,
      settings: {
        ...deck.settings,
        ladder: [
          { direction: 'recognition', opensAtStability: 0 },
          { direction: 'production', opensAtStability: 0 },
        ],
      },
    })),
    notes,
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  const frames = await page
    .getByRole('button', { name: 'Study setup', exact: true })
    .evaluate(async (button) => {
      const content = document.getElementById(button.getAttribute('aria-controls')!)!;
      const observations: { time: number; height: number; bottom: number }[] = [];
      const started = performance.now();
      (button as HTMLButtonElement).click();
      setTimeout(() => {
        const select = [...content.querySelectorAll('select')].at(-1)!;
        select.value = 'production';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, 80);
      setTimeout(() => (button as HTMLButtonElement).click(), 125);
      setTimeout(() => (button as HTMLButtonElement).click(), 175);
      setTimeout(() => (button as HTMLButtonElement).click(), 450);
      setTimeout(() => (button as HTMLButtonElement).click(), 520);
      // Also exercise a completed close and reopen after the interrupted bursts.
      setTimeout(() => (button as HTMLButtonElement).click(), 850);
      setTimeout(() => (button as HTMLButtonElement).click(), 1150);
      await new Promise<void>((resolve) => {
        const collect = (time: number) => {
          observations.push({
            time,
            height: content.getBoundingClientRect().height,
            bottom: content.closest('[data-g]')!.getBoundingClientRect().bottom,
          });
          if (time - started < 1450) requestAnimationFrame(collect);
          else resolve();
        };
        requestAnimationFrame(collect);
      });
      return observations;
    });
  await info.attach('configuration-disclosure-frames', {
    body: JSON.stringify(frames),
    contentType: 'application/json',
  });
  console.info(
    'disclosure-profile',
    JSON.stringify({
      browser: info.project.name,
      frames: frames.length,
      worstFrameMs: Math.max(
        ...frames.slice(1).map((frame, index) => frame.time - frames[index]!.time),
      ),
    }),
  );
  const extent = Math.max(...frames.map((frame) => frame.height));
  const speed = Math.max(
    ...frames.slice(1).map((frame, index) => {
      const previous = frames[index]!;
      const movement = Math.abs(frame.height - previous.height);
      // Chromium can sample an unchanged frame twice at the same timestamp.
      // Stationary samples have zero speed; instantaneous movement still yields Infinity.
      return movement === 0 ? 0 : movement / (frame.time - previous.time);
    }),
  );
  expect(speed).toBeLessThan((extent * 4) / 240);
  expect(
    frames.filter((frame) => frame.height > 1 && frame.height < extent - 1).length,
  ).toBeGreaterThan(3);
  await expect(page.getByRole('combobox', { name: 'Study mode', exact: true })).toHaveValue(
    'production',
  );
});

test('Study disclosure settles immediately with reduced motion and keeps focus visible', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'light', motion: 'reduce' });
  await useFixtures(page, { decks, notes });
  await page.goto('/');
  const setup = page.getByRole('button', { name: 'Study setup', exact: true });
  await setup.click();
  const content = page.locator(`#${await setup.getAttribute('aria-controls')}`);
  await expect(content).toHaveCSS('overflow', 'visible');
  await page.getByRole('combobox', { name: 'Study language', exact: true }).focus();
  await setup.click();
  await expect(content).toHaveAttribute('inert', '');
  await expect(content).toHaveCSS('height', '0px');
  await setup.click();
  await expect(content).toHaveCSS('overflow', 'visible');
});
