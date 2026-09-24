import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

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
    await expect(
      page.getByText('Close. Compare the spelling with the answer.', { exact: false }),
    ).toBeVisible();
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
      .getByRole('button', { name: direction === 'production' ? 'Production' : 'Listening' })
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
