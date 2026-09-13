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
    expect(route.request().postDataJSON()).toEqual({ minutes: 1 });
    await route.fulfill({
      json: {
        cards,
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
  await page.getByText('Time for this session', { exact: true }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Answer 1', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByText('Answer 1', { exact: true })).toBeVisible();
  for (const rating of ['Again', 'Hard', 'Good', 'Easy'])
    await expect(
      page.getByRole('button', { name: new RegExp(`^${rating} [0-9]+ (min|d)$`) }),
    ).toBeVisible();
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
