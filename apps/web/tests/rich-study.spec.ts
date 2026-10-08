import { expect, test } from '@playwright/test';

import { advancePractice } from '@neuron/shared';
import type { PracticeRun } from '@neuron/shared';

import { useFixtures, usePreferences } from './fixtures';
import { useSpeech } from './speech-fixture';

import type { Locator, Page } from '@playwright/test';

const stamp = '2026-01-01T00:00:00Z';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const deck = {
  id: id(1),
  name: 'Words',
  kind: 'deck',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 1,
  position: 0,
  settings: { targetLanguage: 'de' },
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
};
const note = {
  id: id(2),
  deckId: deck.id,
  noteType: 'vocab',
  fields: { term: 'Sorgfalt', translation: 'care' },
  tags: [],
  status: 'active',
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
};
const base = {
  id: id(3),
  noteId: note.id,
  deckId: deck.id,
  direction: 'production',
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
const plan = (card: typeof base) => ({
  cards: [card],
  notes: [note],
  nextDue: null,
  scopeDeckIds: [deck.id],
  deckSummaries: [{ deckId: deck.id, due: 0, fresh: 1, nextDue: null }],
  availableCount: 1,
  estimatedMinutes: 1,
  budgetMinutes: 20,
  reviewCount: 0,
  newCount: 1,
  backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
  newCards: {
    mode: 'automatic',
    admitted: 1,
    allowed: 1,
    headroomMinutes: 20,
    marginalCost: 1,
    reason: 'withinBudget',
    overrideAvailable: false,
    limitedBy: null,
  },
});

test('Today hides obsolete Ready state until a confirmed answer is reconciled', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes: [note] });
  let confirmed = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/study/session', async (route) => {
    if (confirmed) await held;
    await route.fulfill({
      json: confirmed
        ? {
            ...plan(base),
            cards: [],
            availableCount: 0,
            newCount: 0,
            deckSummaries: [{ deckId: deck.id, due: 0, fresh: 0, nextDue: '2027-01-01T04:00:00Z' }],
            nextDue: '2027-01-01T04:00:00Z',
          }
        : plan(base),
    });
  });
  await page.route('**/api/decks', async (route) => {
    if (confirmed) await held;
    await route.fulfill({ json: { decks: [{ ...deck, fresh: confirmed ? 0 : 1 }] } });
  });
  await page.route('**/api/reviews', (route) => {
    confirmed = true;
    return route.fulfill({
      json: {
        card: {
          ...base,
          state: 'review',
          due: '2027-01-01T04:00:00Z',
          stability: 10,
          difficulty: 5,
          lastReview: new Date().toISOString(),
          reps: 1,
        },
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good / }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('status').getByText('Updating plan…')).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(0);
  await expect(page.getByText('You are caught up', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText('You are caught up', { exact: true })).toBeVisible();
});

// These injected session cases isolate card behavior. The enabling test below
// separately exercises the shipped Note editor path into Study.
for (const reduced of [false, true])
  test(`given a production card, typed checking stays local and ratings stay explicit, reduced=${reduced}`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await useFixtures(page, { decks: [deck], notes: [note] });
    await page.route('**/api/study/session', (route) => route.fulfill({ json: plan(base) }));
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reviews: { rating: string }[] = [];
    await page.route('**/api/reviews', async (route) => {
      reviews.push(route.request().postDataJSON());
      await barrier;
      await route.fulfill({
        json: {
          card: {
            ...base,
            state: 'review',
            due: '2027-01-01T04:00:00Z',
            stability: 10,
            difficulty: 5,
            reps: 1,
            lastReview: stamp,
          },
        },
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    const surface = page.locator('.neu-learning-card');
    await expect(surface).toBeVisible();
    await expect(page.locator('[data-shell-content]')).toHaveCSS('position', 'fixed');
    await page.evaluate(() => document.fonts.ready);
    const before = await surface.boundingBox();
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    await page.getByLabel('Type your answer').fill('Sorgfaltx');
    const started = Date.now();
    await page.getByLabel('Type your answer').press('Enter');
    await expect(page.getByText('1 extra letter', { exact: true })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(reviews).toEqual([]);
    await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
    const after = await surface.boundingBox();
    expect(after!.height).toBeLessThan(before!.height);
    expect(
      await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`typed-${reduced}.png`) });
    await page.getByRole('button', { name: /^Hard / }).click();
    await expect(page.getByText('Session complete', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeDisabled();
    expect(reviews[0]!.rating).toBe('hard');
    release();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  });

test('given a listening card, missing and late voices preserve replay and reveal', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const speech = new EventTarget();
    Object.assign(speech, {
      getVoices: () => [],
      cancel: () => undefined,
      speak: (utterance: { lang: string }) => {
        document.documentElement.dataset['spokenLanguage'] = utterance.lang;
      },
    });
    Object.defineProperty(window, 'speechSynthesis', { value: speech, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
      configurable: true,
    });
  });
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes: [note] });
  await page.route('**/api/study/session', (route) =>
    route.fulfill({ json: plan({ ...base, direction: 'listening' }) }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play / replay' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeEnabled();
  await page.evaluate(() => {
    window.speechSynthesis.getVoices = () => [
      { lang: 'de-DE', name: 'German' } as SpeechSynthesisVoice,
    ];
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  await page.getByRole('button', { name: 'Play / replay' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-spoken-language', 'de-DE');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
});

for (const screen of ['Study', 'Practice'] as const)
  test(`${screen} Listen to Type checks the heard term, keeps context hidden, and waits for an explicit decision`, async ({
    page,
  }, info) => {
    await useSpeech(page);
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await useFixtures(page, { decks: [deck], notes: [note] });
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
    });
    if (screen === 'Study') {
      await page.route('**/api/study/session', (route) =>
        route.fulfill({ json: plan({ ...base, direction: 'listening' }) }),
      );
      await page.route('**/api/reviews', (route) => route.fulfill({ json: { card: base } }));
      await page.goto('/');
      await page.getByRole('button', { name: 'Study', exact: true }).click();
    } else {
      let run: PracticeRun | null = null;
      let version = 0;
      await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
        if (route.request().method() === 'POST') {
          run = advancePractice(run, route.request().postDataJSON(), [note]);
          version++;
        }
        return route.fulfill({ json: { run, version } });
      });
      await page.goto(`/notes?deckId=${deck.id}`);
      await page.getByRole('button', { name: 'Start practice', exact: true }).click();
      await page.getByRole('combobox', { name: 'Response mode' }).selectOption('listening');
      const voices = page.getByRole('combobox', { name: /Voice on this device/ });
      await expect(voices).toHaveValue('de-DE|Alpha|alpha');
      await voices.selectOption('de-DE|Beta|beta');
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-spoken-voice', 'Beta');
      await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    }
    await expect(page.getByText('Sorgfalt', { exact: true })).toHaveCount(0);
    await expect(page.getByText('care', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Play / replay', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-spoken-text', 'Sorgfalt');
    await page.evaluate(() => {
      document.documentElement.dataset['speechFail'] = 'true';
    });
    await page.getByRole('button', { name: 'Play / replay', exact: true }).click();
    await expect(
      page.getByText('A usable voice for this language is not available yet.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    await page.getByRole('textbox', { name: 'Type your answer' }).fill('Sorgfaltx');
    if (screen === 'Study')
      await page.getByRole('textbox', { name: 'Type your answer' }).press('Enter');
    else await page.getByRole('button', { name: 'Check answer', exact: true }).click();
    await expect(page.getByText('1 extra letter', { exact: true })).toBeVisible();
    await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
    await expect(page.getByText('care', { exact: true })).toBeVisible();
    expect(writes.filter((path) => path.endsWith('/reviews'))).toHaveLength(0);
    await page.screenshot({
      path: info.outputPath(`listen-type-${screen}.png`),
      animations: 'disabled',
    });
    if (screen === 'Study') {
      for (const rating of ['Again', 'Hard', 'Good', 'Easy'])
        await expect(page.getByRole('button', { name: new RegExp(`^${rating} `) })).toBeEnabled();
      await page.getByRole('button', { name: /^Easy / }).click();
      await expect.poll(() => writes.filter((path) => path.endsWith('/reviews')).length).toBe(1);
    } else {
      await page.getByRole('button', { name: 'Known', exact: true }).click();
      expect(writes.every((path) => path.endsWith('/practice'))).toBe(true);
    }
    await expect(page.locator('html')).toHaveAttribute('data-speech-canceled', 'true');
  });

for (const direction of ['production', 'listening'] as const)
  test(`enabling ${direction} in the Note editor reaches Study`, async ({ page }) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await useFixtures(page, { decks: [deck], notes: [note] });
    const cards = [{ ...base, id: id(4), direction: 'recognition' }];
    let enabled = false;
    await page.route(`**/api/notes/${note.id}`, (route) =>
      route.fulfill({ json: { note, cards } }),
    );
    await page.route(`**/api/notes/${note.id}/cards`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ direction });
      enabled = true;
      const card = { ...base, direction };
      cards.push(card);
      return route.fulfill({ json: { card } });
    });
    await page.route('**/api/study/session', (route) =>
      route.fulfill({
        json: enabled
          ? plan({ ...base, direction })
          : { ...plan(base), cards: [], availableCount: 0, newCount: 0 },
      }),
    );

    await page.goto(`/notes/${note.id}`);
    await page.getByText('Study directions', { exact: true }).click();
    await page
      .getByRole('button', { name: direction === 'production' ? 'Typing' : 'Listening' })
      .click();
    await expect.poll(() => enabled).toBe(true);
    await page.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: direction === 'production' ? 'Type your answer' : 'Play / replay',
      }),
    ).toBeVisible();
  });

for (const screen of ['Study', 'Practice'] as const)
  for (const reduced of [false, true])
    test(`${screen} positions Typing before focus and keeps the learning frame anchored, reduced=${reduced}`, async ({
      page,
    }, info) => {
      await usePreferences(page, { locale: 'en', theme: 'dark' });
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await useFixtures(page, { decks: [deck], notes: [note] });
      if (screen === 'Study') {
        await page.route('**/api/study/session', (route) => route.fulfill({ json: plan(base) }));
        await page.goto('/');
        await page.getByRole('button', { name: 'Study', exact: true }).click();
      } else {
        let run: PracticeRun | null = null;
        let version = 0;
        await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
          if (route.request().method() === 'POST') {
            run = advancePractice(run, route.request().postDataJSON(), [note]);
            version++;
          }
          return route.fulfill({ json: { run, version } });
        });
        await page.goto(`/notes?deckId=${deck.id}`);
        await page.getByRole('button', { name: 'Start practice', exact: true }).click();
        await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
        await page.getByRole('button', { name: 'Start practice', exact: true }).click();
      }
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-top', '47px');
        document.documentElement.style.setProperty('--safe-bottom', '34px');
      });
      const frame = page.locator('[data-shell-content]');
      const card = page.locator('.neu-learning-card');
      await expect(frame).toHaveCSS(
        'padding-top',
        page.viewportSize()!.width < 640 ? '59px' : '71px',
      );
      await page.evaluate(() => document.fonts.ready);
      const normal = await card.boundingBox();
      const initialFrame = await frame.boundingBox();
      const header = await page.locator('.neu-session > header').boundingBox();
      const progress =
        screen === 'Practice' ? await page.locator('.neu-practice-progress').boundingBox() : null;
      await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
      const input = page.getByLabel('Type your answer', { exact: true });
      await expect(input).toBeFocused();
      await expect(page.locator('.neu-session')).toHaveAttribute('data-typing-ready', 'true');
      expect(await page.locator('.neu-session > header').boundingBox()).toEqual(header);
      if (progress)
        expect(await page.locator('.neu-practice-progress').boundingBox()).toEqual(progress);
      const phone = page.viewportSize()!.width < 640;
      if (phone)
        await expect.poll(async () => (await card.boundingBox())?.height).toBeLessThan(350);
      const ready = await card.boundingBox();
      if (phone) {
        expect(ready!.height).toBeLessThan(normal!.height);
        expect(ready!.height).toBeGreaterThan(130);
      } else expect(Math.abs(ready!.height - normal!.height)).toBeLessThanOrEqual(16);
      const full = await page.evaluate(() => window.innerHeight);
      const keyboardTop = full - 270;
      for (const [height, top] of [
        [full - 119, 40],
        [full - 340, 120],
        [full - 270, 0],
        [full - 450, 180],
        [full - 340, 70],
      ]) {
        await page.evaluate(
          ([h, y]) => {
            Object.defineProperties(window.visualViewport!, {
              height: { configurable: true, get: () => h },
              offsetTop: { configurable: true, get: () => y },
            });
            window.visualViewport!.dispatchEvent(new Event('resize'));
            window.visualViewport!.dispatchEvent(new Event('scroll'));
          },
          [height, top],
        );
        await expect
          .poll(async () => (await frame.boundingBox())?.height)
          .toBe(initialFrame!.height);
        const now = await card.boundingBox();
        expect(Math.abs(now!.height - ready!.height)).toBeLessThanOrEqual(2);
        expect((await frame.boundingBox())!.y).toBe(initialFrame!.y);
      }
      const field = await input.boundingBox();
      const action = await page
        .getByRole('button', { name: 'Show answer', exact: true })
        .boundingBox();
      if (phone) {
        expect(field!.y + field!.height).toBeLessThanOrEqual(keyboardTop - 8);
        expect(keyboardTop - (action!.y + action!.height)).toBeGreaterThanOrEqual(0);
        expect(keyboardTop - (action!.y + action!.height)).toBeLessThan(90);
      } else expect(action!.y - (ready!.y + ready!.height)).toBeLessThan(24);
      expect(await input.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
      await page.screenshot({ path: info.outputPath(`typing-ready-${screen}-${reduced}.png`) });
      await input.fill('Sorgfalt');
      await input.press('Enter');
      await expect(page.locator('.neu-spelling')).toBeVisible();
      await expect(input).toHaveCount(0);
      await page.evaluate((height) => {
        Object.defineProperties(window.visualViewport!, {
          height: { configurable: true, get: () => height },
          offsetTop: { configurable: true, get: () => 0 },
        });
        window.visualViewport!.dispatchEvent(new Event('resize'));
      }, full);
      expect((await frame.boundingBox())!.height).toBe(initialFrame!.height);
      if (screen === 'Study')
        await expect(page.getByRole('button', { name: /^Good / })).toBeEnabled();
      else await expect(page.getByRole('button', { name: 'Known', exact: true })).toBeEnabled();
    });

for (const screen of ['Study', 'Practice'] as const)
  for (const [height, visibleTop] of [
    [667, 390],
    [932, 590],
  ] as const)
    test(`${screen} fills the keyboard-ready space at ${height}px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height });
      await usePreferences(page, { locale: 'en', theme: 'dark' });
      await useFixtures(page, { decks: [deck], notes: [note] });
      if (screen === 'Study') {
        await page.route('**/api/study/session', (route) => route.fulfill({ json: plan(base) }));
        await page.goto('/');
        await page.getByRole('button', { name: 'Study', exact: true }).click();
      } else {
        let run: PracticeRun | null = null;
        await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
          if (route.request().method() === 'POST')
            run = advancePractice(run, route.request().postDataJSON(), [note]);
          return route.fulfill({ json: { run, version: run ? 1 : 0 } });
        });
        await page.goto(`/notes?deckId=${deck.id}`);
        await page.getByRole('button', { name: 'Start practice', exact: true }).click();
        await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
        await page.getByRole('button', { name: 'Start practice', exact: true }).click();
      }
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-top', '47px');
        document.documentElement.style.setProperty('--safe-bottom', '34px');
        document.documentElement.style.fontSize = '125%';
      });
      await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
      const input = page.getByLabel('Type your answer', { exact: true });
      await expect(input).toBeFocused();
      const card = await page.locator('.neu-learning-card').boundingBox();
      const action = await page.getByRole('button', { name: 'Show answer' }).boundingBox();
      const field = await input.boundingBox();
      expect(card!.height).toBeGreaterThan(height === 667 ? 125 : 290);
      expect(action!.y - (card!.y + card!.height)).toBeLessThan(24);
      expect(visibleTop - (action!.y + action!.height)).toBeGreaterThanOrEqual(0);
      expect(visibleTop - (action!.y + action!.height)).toBeLessThan(90);
      expect(field!.y + field!.height).toBeLessThan(visibleTop - 12);
    });

for (const screen of ['Study', 'Practice'] as const)
  test(`${screen} reopens Typing and advances through a second card`, async ({ page }) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    const second = { ...note, id: id(20), fields: { term: 'Baum', translation: 'tree' } };
    await useFixtures(page, { decks: [deck], notes: [note, second] });
    if (screen === 'Study') {
      await page.route('**/api/study/session', (route) =>
        route.fulfill({
          json: {
            ...plan(base),
            cards: [base, { ...base, id: id(21), noteId: second.id }],
            notes: [note, second],
            availableCount: 2,
            newCount: 2,
          },
        }),
      );
      await page.route('**/api/reviews', (route) => route.fulfill({ json: { card: base } }));
      await page.goto('/');
      await page.getByRole('button', { name: 'Study', exact: true }).click();
    } else {
      let run: PracticeRun | null = null;
      let version = 0;
      await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
        if (route.request().method() === 'POST') {
          run = advancePractice(run, route.request().postDataJSON(), [note, second]);
          version++;
        }
        return route.fulfill({ json: { run, version } });
      });
      await page.goto(`/notes?deckId=${deck.id}`);
      await page.getByRole('button', { name: 'Start practice', exact: true }).click();
      await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
      await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    const first = page.getByLabel('Type your answer', { exact: true });
    await expect(first).toBeFocused();
    await first.press('Enter');
    await expect(page.locator('.neu-spelling')).toHaveCount(0);
    await first.fill('Sorgfaltx');
    await first.blur();
    await expect(page.locator('.neu-session')).not.toHaveAttribute('data-typing-ready', 'true');
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    await expect(first).toBeFocused();
    await expect(first).toHaveValue('Sorgfaltx');
    await first.fill('Sorgfalt');
    await first.press('Enter');
    await expect(page.locator('.neu-spelling')).toBeVisible();
    if (screen === 'Study') await page.getByRole('button', { name: /^Good / }).click();
    else await page.getByRole('button', { name: 'Known', exact: true }).click();
    await expect(page.getByText('tree', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    await expect(page.getByLabel('Type your answer', { exact: true })).toBeFocused();
  });

for (const submitted of [
  'Sorgfalt',
  'sorgfalt',
  'Sorgfaltx',
  'Sorgfat',
  'Sorgfelt',
  'Banane',
  'Genauigkeit',
])
  test(`typed feedback remains local: ${submitted}`, async ({ page }, info) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await useFixtures(page, { decks: [deck], notes: [note] });
    await page.route('**/api/study/session', (route) =>
      route.fulfill({
        json: {
          ...plan(base),
          notes: [{ ...note, fields: { ...note.fields, acceptedAnswers: ['Genauigkeit'] } }],
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    const input = page.getByLabel('Type your answer', { exact: true });
    await input.fill(submitted);
    await input.press('Enter');
    await expect(page.locator('.neu-spelling')).toContainText(
      submitted === 'Sorgfat' ? 'Sorgfalt' : submitted,
    );
    if (submitted === 'Banane') {
      await expect(page.getByRole('status')).toContainText('Incorrect');
      await expect(page.getByRole('status')).not.toContainText('Spelling differences');
    }
    await expect(page.locator('[data-g="tabbar"]')).not.toBeVisible();
    for (const name of ['Again', 'Hard', 'Good', 'Easy'])
      await expect(page.getByRole('button', { name: new RegExp(`^${name} `) })).toBeInViewport({
        ratio: 1,
      });
    await page.screenshot({ path: info.outputPath('feedback.png') });
  });

// Measure the first frame with the expected local state, independently of transport.
async function responsePaint(
  page: Page,
  button: Locator,
  expected: { text: string; visible: boolean },
) {
  await button.evaluate((element, expected) => {
    const measured = window as unknown as {
      nextPaint: Promise<{ milliseconds: number; text: string }>;
    };
    measured.nextPaint = new Promise((resolve) =>
      element.addEventListener(
        'click',
        () => {
          const started = performance.now();
          const sample = (now: number) => {
            const text = document.body.innerText;
            if (text.includes(expected.text) === expected.visible || now - started >= 200)
              resolve({ milliseconds: now - started, text });
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        },
        { once: true },
      ),
    );
  }, expected);
  await button.click();
  return page.evaluate(
    () =>
      (window as unknown as { nextPaint: Promise<{ milliseconds: number; text: string }> })
        .nextPaint,
  );
}
for (const success of [true, false])
  test(`participation projects through Today and Library before transport, success=${success}`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    const material = {
      ...note,
      studyCards: [{ direction: 'production', state: 'new', due: stamp, suspendedAt: null }],
    };
    let known = false;
    await useFixtures(page, { decks: [{ ...deck, noteCount: 1 }], notes: [material] });
    await page.route(`**/api/notes/${note.id}`, (route) =>
      route.fulfill({
        json: { note: { ...material, status: known ? 'known' : 'active' }, cards: [base] },
      }),
    );
    await page.route('**/api/decks', (route) =>
      route.fulfill({ json: { decks: [{ ...deck, noteCount: 1, fresh: known ? 0 : 1 }] } }),
    );
    await page.route('**/api/study/session', (route) =>
      route.fulfill({
        json: known
          ? {
              ...plan(base),
              cards: [],
              notes: [],
              availableCount: 0,
              newCount: 0,
              deckSummaries: [{ deckId: deck.id, due: 0, fresh: 0, nextDue: null }],
            }
          : plan(base),
      }),
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/notes/status', async (route) => {
      await held;
      if (success) known = true;
      await route.fulfill(
        success
          ? { json: { changed: 1 } }
          : {
              status: 500,
              json: { error: { code: 'internal_error', correlationId: 'held-write' } },
            },
      );
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: /Words 0 to review/ }).click();
    await page.getByRole('button', { name: /Sorgfalt care/ }).click();
    const measured = await responsePaint(
      page,
      page.getByRole('button', { name: 'Mark as known', exact: true }),
      { text: 'Known', visible: true },
    );
    console.info('local-paint', info.title, measured.milliseconds);
    expect(measured.milliseconds).toBeLessThan(200);
    expect(measured.text).toContain('Known');
    expect(known).toBe(false);
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(page.getByText('You are caught up', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Words 1 notes', exact: true })).toBeVisible();
    release();
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    if (success) await expect(page.getByText('You are caught up', { exact: true })).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
    await info.attach('participation-paint', {
      body: JSON.stringify({ milliseconds: measured.milliseconds, success, requestHeld: true }),
      contentType: 'application/json',
    });
  });

test('moving a note projects its row and both Deck counts before transport', async ({
  page,
}, info) => {
  const target = { ...deck, id: id(8), name: 'Destination', fresh: 0, noteCount: 0 };
  const material = {
    ...note,
    studyCards: [{ direction: 'production', state: 'new', due: stamp, suspendedAt: null }],
  };
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [{ ...deck, noteCount: 1 }, target], notes: [material] });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let moveRequested = false;
  let moveSettled = false;
  await page.route('**/api/notes/move', async (route) => {
    moveRequested = true;
    await held;
    moveSettled = true;
    await route.fulfill({
      status: 500,
      json: { error: { code: 'internal_error', correlationId: 'held-move' } },
    });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Select notes', exact: true }).click();
  await page.getByRole('button', { name: /Sorgfalt care/ }).click();
  await page.getByRole('button', { name: 'Move to a deck', exact: true }).click();
  const measured = await responsePaint(
    page,
    page.getByRole('dialog').getByRole('button', { name: 'Move to a deck', exact: true }),
    { text: 'Sorgfalt', visible: false },
  );
  console.info('local-paint', info.title, measured.milliseconds);
  expect(measured.milliseconds).toBeLessThan(200);
  expect(measured.text).not.toContain('Sorgfalt');
  await expect.poll(() => moveRequested).toBe(true);
  const requestHeld = moveRequested && !moveSettled;
  expect(requestHeld).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Words 0 notes', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Destination 1 notes · 0 to review · 1 new', exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole('button', { name: 'Words 1 notes · 0 to review · 1 new', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Words 1 notes/ }).click();
  await expect(page.getByRole('button', { name: /Sorgfalt care/ })).toBeVisible();
  await info.attach('move-paint', {
    body: JSON.stringify({ milliseconds: measured.milliseconds, requestHeld }),
    contentType: 'application/json',
  });
});

test('My Study Decks scope reacts locally while a replacement admission plan is held', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes: [note] });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/study/session', async (route) => {
    if (Array.isArray(route.request().postDataJSON().deckIds)) await held;
    await route.fulfill({ json: plan(base) });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  await page.getByRole('button', { name: 'Words', exact: true }).click();
  await page.getByRole('checkbox', { name: /Words/ }).uncheck();
  const measured = await responsePaint(
    page,
    page.getByRole('button', { name: 'Apply', exact: true }),
    { text: 'No decks selected', visible: true },
  );
  console.info('local-paint', info.title, measured.milliseconds);
  expect(measured.milliseconds).toBeLessThan(200);
  expect(measured.text).toContain('No decks selected');
  await expect(page.getByRole('button', { name: /Words 0 to review/ })).toHaveCount(0);
  release();
});

for (const reduced of [false, true])
  test(`Practice completion progresses without blocking actions, reduced=${reduced}`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await useFixtures(page, { decks: [deck], notes: [note] });
    let run: PracticeRun | null = null,
      version = 0;
    await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
      if (route.request().method() === 'POST') {
        run = advancePractice(run, route.request().postDataJSON(), [note]);
        version++;
      }
      return route.fulfill({ json: { run, version } });
    });
    await page.goto(`/notes?deckId=${deck.id}`);
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await page.getByRole('button', { name: 'Known', exact: true }).click();
    const ring = page.getByRole('img', { name: 'Known: 100%', exact: true });
    await expect(ring).toBeVisible();
    const initial = await ring.innerText();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
    if (reduced) expect(initial).toBe('100%');
    else {
      expect(parseInt(initial)).toBeLessThan(100);
      await page.screenshot({ path: info.outputPath('completion-drawing.png') });
    }
    await expect(ring).toHaveText('100%');
    await page.screenshot({ path: info.outputPath('completion-final.png') });
  });
