import { expect, test } from '@playwright/test';

import { useFixtures as installFixtures, usePreferences as installPreferences } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * Learning waves as the learner meets them: a large Deck shows the wave now
 * entering Study and why the rest waits, and Today names the wave instead of
 * every new Note the Deck will ever hold. The plan comes from the api; what the
 * planner decides is covered by the unit and database tests.
 */

const WAVE = {
  deckId: 'd3',
  number: 3,
  count: 60,
  size: 50,
  started: 18,
  waiting: 32,
  unsure: 6,
  later: 2850,
  today: 8,
};
const OPEN = { allowed: 8, reason: 'withinBudget' };

async function withPlan(
  page: Page,
  wave: Partial<typeof WAVE> = {},
  decision: { allowed: number; reason: string } = OPEN,
) {
  await page.route(
    (url) => url.pathname === '/api/study/session',
    (route) =>
      route.fulfill({
        json: {
          planningContext: { accountId: 'user_1', revision: 42 },
          cards: [],
          notes: [],
          nextDue: null,
          scopeDeckIds: ['d3'],
          deckSummaries: [{ deckId: 'd3', due: 2, fresh: 40, nextDue: null }],
          waves: [{ ...WAVE, ...wave }],
          availableCount: 42,
          estimatedMinutes: 6,
          budgetMinutes: 20,
          reviewCount: 2,
          newCount: 8,
          backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
          newCards: {
            mode: 'automatic',
            admitted: decision.allowed,
            headroomMinutes: 4,
            marginalCost: 0.4,
            overrideAvailable: false,
            limitedBy: null,
            ...decision,
          },
        },
      }),
  );
}

async function open(page: Page) {
  await installPreferences(page, { theme: 'dark', locale: 'en' });
  await installFixtures(page);
}

/** The Deck screen requests no plan: Today plans, then the Deck shows that plan's wave. */
async function deckAfterToday(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Verben mit Dativ/ }).click();
  await expect(page.getByRole('heading', { name: 'Verben mit Dativ' })).toBeVisible();
}

test('a large Deck shows its current wave, what Study lets in today and what waits', async ({
  page,
}) => {
  await open(page);
  await withPlan(page);
  let plans = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/study/session') plans++;
  });
  await deckAfterToday(page);

  await expect(page.getByRole('heading', { name: 'Wave 3 of 60' })).toBeVisible();
  // The Deck screen made no plan of its own.
  expect(plans).toBe(1);
  await expect(page.getByText('18 / 50 started', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Notes started in this wave' }),
  ).toHaveAttribute('aria-valuenow', '36');
  await expect(page.getByText('Study lets in 8 today.', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Waiting in this wave: 32. Unsure go first: 6. At today’s pace, the next wave starts in about 4 days.',
      { exact: true },
    ),
  ).toBeVisible();
  // The title says which wave of how many; the later waves are not repeated as a sentence.
  await expect(page.getByText(/more wait in later waves/)).toHaveCount(0);
});

test('when reviews fill the minutes, the wave says why nothing new comes in', async ({ page }) => {
  await open(page);
  await withPlan(page, { today: 0 }, { allowed: 0, reason: 'forecastOverBudget' });
  await deckAfterToday(page);

  await expect(
    page.getByText(
      'None today: reviews already fill your minutes a day. New Notes come in as time frees up.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/The next wave starts when every Note in this one has started\.$/),
  ).toBeVisible();
});

test('a Deck no larger than one wave, or with everything started, shows no wave', async ({
  page,
}) => {
  await open(page);
  await withPlan(page, { number: 1, count: 1, size: 20, started: 0, waiting: 20, later: 0 });
  await deckAfterToday(page);
  await expect(page.getByRole('heading', { name: /^Wave / })).toHaveCount(0);

  await page.unroute((url) => url.pathname === '/api/study/session');
  await withPlan(page, { number: 0, size: 0, started: 0, waiting: 0, later: 0 });
  await deckAfterToday(page);
  await expect(page.getByRole('heading', { name: /^Wave / })).toHaveCount(0);
});

test('opened directly, before Today has planned, a Deck requests no plan and shows no wave', async ({
  page,
}) => {
  await open(page);
  await withPlan(page);
  let plans = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/study/session') plans++;
  });
  await page.goto('/notes?deckId=d3');
  await expect(page.getByRole('heading', { name: 'Verben mit Dativ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Wave / })).toHaveCount(0);
  expect(plans).toBe(0);
});

test('Today names the wave instead of every new Note in the Deck', async ({ page }) => {
  await open(page);
  await withPlan(page);
  await page.goto('/');

  await expect(page.getByText('2 to review · wave 3: 32 new', { exact: true })).toBeVisible();
  await expect(page.getByText('2 to review · 40 new', { exact: true })).toHaveCount(0);
});
