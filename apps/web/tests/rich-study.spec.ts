import { expect, test } from '@playwright/test';

import { advancePractice } from '@neuron/shared';
import type { PracticeRun } from '@neuron/shared';

import { useFixtures, usePreferences } from './fixtures';

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
    const surface = page.locator('[data-g="card"]').first();
    const before = await surface.boundingBox();
    await page.getByLabel('Type your answer').fill('Sorgfaltx');
    const started = Date.now();
    await page.getByLabel('Type your answer').press('Enter');
    await expect(page.getByText('1 extra letter', { exact: true })).toBeVisible();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(reviews).toEqual([]);
    await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
    const after = await surface.boundingBox();
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
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
        name: direction === 'production' ? 'Check answer' : 'Play / replay',
      }),
    ).toBeVisible();
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
  test(`typing keyboard composition and feedback: ${submitted}`, async ({ page }, info) => {
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
    const input = page.getByLabel('Type your answer', { exact: true });
    await input.click();
    // Stage the same visual viewport source used by the Safari regression harness.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', {
        configurable: true,
        get: () => 476,
      });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
    const scroll = await page.evaluate(() => window.scrollY);
    await input.pressSequentially('Sorg');
    await input.fill('A longer answer stays within the single line input');
    await expect(input).toBeFocused();
    expect(await input.evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
    const prompt = await page.locator('.neu-learning-prompt').boundingBox();
    const field = await input.boundingBox();
    expect(prompt!.y).toBeGreaterThanOrEqual(0);
    expect(prompt!.y + prompt!.height).toBeLessThan(field!.y);
    expect(field!.y + field!.height).toBeLessThanOrEqual(464);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
    await page.screenshot({ path: info.outputPath('keyboard.png') });
    await input.fill(submitted);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'closed');
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', {
        configurable: true,
        get: () => window.innerHeight,
      });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('.neu-spelling')).toContainText(
      submitted === 'Sorgfat' ? 'Sorgfalt' : submitted,
    );
    if (submitted === 'Banane') {
      await expect(page.getByRole('status')).toContainText('Incorrect');
      await expect(page.getByRole('status')).not.toContainText('Spelling differences');
    }
    await expect(page.locator('[data-g="tabbar"]')).not.toBeVisible();
    for (const name of ['Again', 'Hard', 'Good', 'Easy']) {
      const button = page.getByRole('button', { name: new RegExp(`^${name} `) });
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: info.outputPath('feedback.png') });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  });

// Measure paint after a real click, independently of the unresolved transport.
async function responsePaint(page: Page, button: Locator) {
  await button.evaluate((element) => {
    const measured = window as unknown as {
      nextPaint: Promise<{ milliseconds: number; text: string }>;
    };
    measured.nextPaint = new Promise((resolve) =>
      element.addEventListener(
        'click',
        () => {
          const started = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({ milliseconds: performance.now() - started, text: document.body.innerText }),
            ),
          );
        },
        { once: true },
      ),
    );
  });
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
  await page.route('**/api/notes/move', async (route) => {
    await held;
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
  );
  console.info('local-paint', info.title, measured.milliseconds);
  expect(measured.milliseconds).toBeLessThan(200);
  expect(measured.text).not.toContain('Sorgfalt');
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
  await info.attach('move-paint', {
    body: JSON.stringify({ milliseconds: measured.milliseconds, requestHeld: true }),
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
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Choose for this session', exact: true }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const measured = await responsePaint(
    page,
    page.getByRole('button', { name: 'Apply', exact: true }),
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
    await page.getByRole('button', { name: 'Practice', exact: true }).click();
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
