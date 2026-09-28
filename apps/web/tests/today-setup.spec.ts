import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

const stamp = '2026-01-01T00:00:00Z';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const deck = (n: number) => ({
  id: id(n),
  name: `Deck ${n}`,
  kind: 'deck',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 1,
  position: n,
  settings: {},
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
});
const note = {
  id: id(10),
  deckId: id(1),
  noteType: 'basic',
  fields: { front: 'Question', back: 'Answer' },
  tags: [],
  status: 'active',
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
};
const card = {
  id: id(20),
  noteId: note.id,
  deckId: note.deckId,
  direction: 'recognition',
  slot: 0,
  state: 'new',
  stability: null,
  difficulty: null,
  due: stamp,
  lastReview: null,
  reps: 0,
  lapses: 0,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: stamp,
  updatedAt: stamp,
  rev: 1,
};

test('Study setup is visible, temporary, and gives a direct single-Deck skill action', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck(1)], notes: [note] });
  const bodies: { minutes?: number; direction?: string; deckIds?: string[] }[] = [];
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes.push(new URL(request.url()).pathname);
  });
  await page.route('**/api/study/session', (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const available = !body.direction || body.direction === 'recognition';
    return route.fulfill({
      json: {
        cards: available ? [card] : [],
        notes: available ? [note] : [],
        nextDue: null,
        scopeDeckIds: [deck(1).id],
        deckSummaries: [{ deckId: deck(1).id, due: 0, fresh: available ? 1 : 0, nextDue: null }],
        availableCount: available ? 1 : 0,
        estimatedMinutes: 1,
        budgetMinutes: body.minutes ?? 20,
        reviewCount: 0,
        newCount: available ? 1 : 0,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: available ? 1 : 0,
          allowed: 1,
          headroomMinutes: 20,
          marginalCost: 1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'My study decks' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Time for this session' })).toBeVisible();
  const mode = page.getByRole('combobox', { name: 'Study mode' });
  await expect(mode).toBeVisible();
  for (const label of ['Mixed', 'Recognition', 'Recall', 'Typing', 'Listening'])
    await expect(mode.getByRole('option', { name: label })).toBeAttached();
  await page.getByRole('combobox', { name: 'Time for this session' }).selectOption('5');
  await mode.selectOption('production');
  await expect.poll(() => bodies.at(-1)).toMatchObject({ minutes: 5, direction: 'production' });
  await expect(page.getByText('Nothing ready in this mode')).toBeVisible();
  await page.getByRole('button', { name: 'Open Deck skills' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Typing' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
  await mode.selectOption('recognition');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByText('Question', { exact: true })).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ minutes: 5, direction: 'recognition' });
  expect(writes).toEqual([]);
});

test('multi-Deck Study mode explains missing skills without bulk editing', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck(1), deck(2)], notes: [note] });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH') writes.push(new URL(request.url()).pathname);
  });
  await page.route('**/api/study/session', (route) =>
    route.fulfill({
      json: {
        cards: [],
        notes: [],
        nextDue: null,
        scopeDeckIds: [deck(1).id, deck(2).id],
        deckSummaries: [],
        availableCount: 0,
        estimatedMinutes: 0,
        budgetMinutes: 20,
        reviewCount: 0,
        newCount: 0,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: 0,
          allowed: 0,
          headroomMinutes: 20,
          marginalCost: 1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('listening');
  await expect(
    page.getByText(
      'This Study skill is off in 2 selected Decks. Change each Deck deliberately in its settings.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Deck skills' })).toHaveCount(0);
  expect(writes).toEqual([]);
});
