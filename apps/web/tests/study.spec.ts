import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const cards = [1, 2, 3].map((n) => ({
  id: id(n),
  noteId: id(n + 10),
  deckId: id(30),
  direction: 'recognition',
  slot: 0,
  state: 'new',
  stability: null,
  difficulty: null,
  due: '2026-01-01T00:00:00.000Z',
  lastReview: null,
  reps: 0,
  lapses: 0,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  rev: 1,
}));

test('study previews, advances before saving, retries the same answer and completes', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  await page.route('**/api/study/session', async (route) => {
    expect(route.request().postDataJSON()).toBeDefined();
    await route.fulfill({
      json: {
        cards,
        notes: cards.map((card, index) => ({
          id: card.noteId,
          deckId: card.deckId,
          noteType: 'basic',
          fields: { front: `Question ${index + 1}`, back: `Answer ${index + 1}` },
          tags: [],
          source: null,
          rank: null,
          status: 'active',
          importBatchId: null,
          createdAt: card.updatedAt,
          updatedAt: card.updatedAt,
          rev: 1,
        })),
        nextDue: null,
        availableCount: 3,
        estimatedMinutes: 1,
        budgetMinutes: 1,
        reviewCount: 0,
        newCount: 2,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: 2,
          allowed: 10,
          headroomMinutes: 20,
          marginalCost: 1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    });
  });
  for (const [index, card] of cards.entries())
    await page.route(`**/api/notes/${card.noteId}`, (route) =>
      route.fulfill({
        json: {
          note: {
            id: card.noteId,
            noteType: 'basic',
            fields: { front: `Question ${index + 1}`, back: `Answer ${index + 1}` },
          },
          cards: [card],
        },
      }),
    );
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answers: { id: string; cardId: string }[] = [];
  await page.route('**/api/reviews', async (route) => {
    const answer = route.request().postDataJSON();
    answers.push(answer);
    if (answers.length === 1) {
      await barrier;
      await route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
      return;
    }
    const card = cards.find((item) => item.id === answer.cardId)!;
    await route.fulfill({
      json: {
        card: {
          ...card,
          state: 'review',
          stability: 3,
          difficulty: 5,
          lastReview: answer.reviewedAt,
          due: '2027-01-01T00:00:00.000Z',
          reps: 1,
        },
      },
    });
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Study setup', exact: true }).click();
  await page.getByLabel('Time for this session').selectOption('5');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Answer 1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText('Answer 1', { exact: true })).toBeVisible();
  for (const rating of ['Again', 'Hard', 'Good', 'Easy'])
    await expect(
      page.getByRole('button', { name: new RegExp(`^${rating} [0-9]+ (min|d)$`) }),
    ).toBeVisible();
  const geometry = await page.getByRole('button', { name: /^Again / }).evaluate((button) => {
    const [label, interval] = button.querySelectorAll('span > span');
    const a = label!.getBoundingClientRect();
    const b = interval!.getBoundingClientRect();
    return {
      centered: Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1,
      stacked: b.y >= a.bottom,
      nowrap: getComputedStyle(interval!).whiteSpace === 'nowrap',
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
    };
  });
  expect(geometry.centered).toBe(true);
  expect(geometry.stacked).toBe(true);
  expect(geometry.nowrap).toBe(true);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath('study-ratings.png') });
  await page.getByRole('button', { name: /^Good / }).click();
  await expect(page.getByText('Question 2', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText(/An answer could not be confirmed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeEnabled();
  expect(answers[0]?.id).toBe(answers[1]?.id);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.clock.fastForward(60_001);
  await expect(page.getByText('Answer 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect(page.getByText('Session complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Question 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('Study rewinds the full local session while answers and compensations serialize', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  let planReads = 0;
  let deckReads = 0;
  await page.route('**/api/decks', (route) => {
    deckReads++;
    return route.fallback();
  });
  await page.route('**/api/study/session', (route) => {
    planReads++;
    return route.fulfill({
      json: {
        cards,
        notes: cards.map((card, index) => ({
          id: card.noteId,
          deckId: card.deckId,
          noteType: 'basic',
          fields: { front: `Question ${index + 1}`, back: `Answer ${index + 1}` },
          tags: [],
          status: 'active',
          source: null,
          rank: null,
          importBatchId: null,
          createdAt: card.updatedAt,
          updatedAt: card.updatedAt,
          rev: 1,
        })),
        scopeDeckIds: [cards[0]!.deckId],
        deckSummaries: [{ deckId: cards[0]!.deckId, due: 0, fresh: 3, nextDue: null }],
        nextDue: null,
        availableCount: 3,
        estimatedMinutes: 1,
        budgetMinutes: 20,
        reviewCount: 0,
        newCount: 3,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: 3,
          allowed: 3,
          headroomMinutes: 20,
          marginalCost: 1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    });
  });
  let releaseFirst!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const events: { kind: string; id: string; cardId?: string; reviewId?: string }[] = [];
  let failedUndo = false;
  await page.route('**/api/reviews/undo', async (route) => {
    const body = route.request().postDataJSON() as { id: string; reviewId: string };
    events.push({ kind: 'undo', ...body });
    if (!failedUndo) {
      failedUndo = true;
      await route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
    } else {
      const original = events.find((event) => event.id === body.reviewId)!;
      await route.fulfill({ json: { card: cards.find((card) => card.id === original.cardId) } });
    }
  });
  await page.route('**/api/reviews', async (route) => {
    const body = route.request().postDataJSON() as {
      id: string;
      cardId: string;
      reviewedAt: string;
    };
    events.push({ kind: 'answer', ...body });
    if (events.length === 1) await held;
    const original = cards.find((card) => card.id === body.cardId)!;
    await route.fulfill({
      json: {
        card: {
          ...original,
          state: 'review',
          stability: 8,
          difficulty: 5,
          due: '2027-01-01T00:00:00Z',
          lastReview: body.reviewedAt,
          reps: 1,
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  for (let index = 1; index <= 3; index++) {
    await expect(page.getByText(`Question ${index}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: /^Good / }).click();
  }
  await expect(page.getByText('Session complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toBeEnabled();
  for (const index of [3, 2, 1]) {
    await page.getByRole('button', { name: 'Undo last answer' }).click();
    await expect(page.getByText(`Question ${index}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('progressbar', { name: 'Study' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
  expect(events).toHaveLength(1);
  for (let index = 1; index <= 3; index++) {
    await expect(page.getByText(`Question ${index}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Good / }).click();
    if (index < 3) await page.getByRole('button', { name: 'Show answer' }).click();
  }
  await expect(page.getByText('Session complete', { exact: true })).toBeVisible();
  releaseFirst();
  await expect(page.getByText('An answer could not be confirmed.')).toBeVisible();
  await expect(page.getByText('Session complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeEnabled();
  expect(events.map((event) => event.kind)).toEqual([
    'answer',
    'answer',
    'answer',
    'undo',
    'undo',
    'undo',
    'undo',
    'answer',
    'answer',
    'answer',
  ]);
  expect(events[3]!.id).toBe(events[4]!.id);
  expect(events[0]!.id).not.toBe(events[7]!.id);
  const beforeExit = { planReads, deckReads };
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect.poll(() => planReads).toBeGreaterThan(beforeExit.planReads);
  expect(deckReads).toBe(beforeExit.deckReads);
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
});

test('Study rewinds a repeated learning card and keeps future planned work ordered', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  await page.route('**/api/study/session', (route) =>
    route.fulfill({
      json: {
        cards: cards.slice(0, 2),
        notes: cards.slice(0, 2).map((card, index) => ({
          id: card.noteId,
          deckId: card.deckId,
          noteType: 'basic',
          fields: { front: `Question ${index + 1}`, back: `Answer ${index + 1}` },
          tags: [],
          status: 'active',
          source: null,
          rank: null,
          importBatchId: null,
          createdAt: card.updatedAt,
          updatedAt: card.updatedAt,
          rev: 1,
        })),
        scopeDeckIds: [cards[0]!.deckId],
        deckSummaries: [],
        nextDue: null,
        availableCount: 2,
        estimatedMinutes: 1,
        budgetMinutes: 20,
        reviewCount: 0,
        newCount: 2,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: 2,
          allowed: 2,
          headroomMinutes: 20,
          marginalCost: 1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    }),
  );
  const answers: { id: string; cardId: string }[] = [];
  const cancellations: string[] = [];
  await page.route('**/api/reviews', (route) => {
    const answer = route.request().postDataJSON();
    answers.push(answer);
    return route.fulfill({ json: { card: cards.find((card) => card.id === answer.cardId) } });
  });
  await page.route('**/api/reviews/undo', (route) => {
    const command = route.request().postDataJSON();
    cancellations.push(command.reviewId);
    return route.fulfill({
      json: {
        card: cards.find(
          (card) => card.id === answers.find((answer) => answer.id === command.reviewId)?.cardId,
        ),
      },
    });
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Again / }).click();
  await expect(page.getByText('Question 2', { exact: true })).toBeVisible();
  await page.clock.fastForward(2 * 60_000);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good / }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good / }).click();
  await page.getByRole('button', { name: 'Undo last answer' }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last answer' }).click();
  await expect(page.getByText('Question 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last answer' }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Study' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect(page.getByText('Question 2', { exact: true })).toBeVisible();
  await expect
    .poll(() => cancellations)
    .toEqual(
      answers
        .slice(0, 3)
        .reverse()
        .map((answer) => answer.id),
    );
  expect(answers[0]!.cardId).toBe(answers[2]!.cardId);
  expect(answers[3]!.id).not.toBe(answers[0]!.id);
});
