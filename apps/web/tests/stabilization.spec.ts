import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

import type { Page } from '@playwright/test';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-01-01T00:00:00.000Z';
const deck = {
  id: id(100),
  name: 'Practice deck',
  kind: 'deck',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 10,
  position: 0,
  settings: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
};
const notes = Array.from({ length: 10 }, (_, n) => ({
  id: id(n + 1),
  deckId: deck.id,
  noteType: 'basic',
  fields: { front: `Question ${n + 1}`, back: `Answer ${n + 1}` },
  tags: [],
  source: null,
  rank: null,
  status: n === 0 ? 'known' : 'active',
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
}));

async function dragWithMouse(page: Page, name: string, targetId: string) {
  const handle = page.getByRole('button', { name, exact: true });
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2);
  const target = page.locator(`[data-drop-target="${targetId}"]`);
  await expect(target).toBeVisible();
  const end = (await target.boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('undo is local during a delayed save and regrade follows its compensation', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const card = {
    id: id(400),
    noteId: notes[1]!.id,
    deckId: deck.id,
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
    unlockedAt: null,
    updatedAt: stamp,
    rev: 1,
  };
  await page.route('**/api/study/session', (route) =>
    route.fulfill({
      json: {
        cards: [card],
        notes: [notes[1]],
        nextDue: null,
        availableCount: 1,
        estimatedMinutes: 0.1,
        budgetMinutes: 20,
        reviewCount: 0,
        newCount: 1,
        backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
        newCards: {
          mode: 'automatic',
          admitted: 1,
          allowed: 1,
          headroomMinutes: 20,
          marginalCost: 0.1,
          reason: 'withinBudget',
          overrideAvailable: false,
          limitedBy: null,
        },
      },
    }),
  );
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [];
  await page.route('**/api/reviews', async (route) => {
    events.push(route.request().postDataJSON().rating);
    if (events.length === 1) await barrier;
    await route.fulfill({
      json: {
        card: {
          ...card,
          state: 'review',
          stability: 8,
          difficulty: 5,
          due: '2027-01-01T00:00:00Z',
          lastReview: stamp,
          reps: 1,
        },
      },
    });
  });
  await page.route('**/api/reviews/undo', async (route) => {
    events.push('undo');
    await route.fulfill({ json: { card } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: /^Easy / }).click();
  await expect(page.getByText('Session complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect(page.getByText('Answer 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Good / }).click();
  release();
  await expect.poll(() => events).toEqual(['easy', 'easy', 'undo', 'good']);
});

test('ten rapid deletes and restores settle once under delayed responses', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const deleted = new Set<string>();
  await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [deck] } }));
  await page.route('**/api/notes?**', (route) =>
    route.fulfill({ json: { items: notes.filter((note) => !deleted.has(note.id)) } }),
  );
  let recoveryReads = 0;
  await page.route('**/api/notes/deleted', (route) => {
    recoveryReads++;
    return route.fulfill({
      json: {
        notes: notes
          .filter((note) => deleted.has(note.id))
          .map((note) => ({ ...note, deckLive: true, deckPath: [deck.name] })),
      },
    });
  });
  const removals: (() => void)[] = [];
  const restores: (() => void)[] = [];
  await page.route(/\/api\/notes\/019.*$/, async (route) => {
    const match = route
      .request()
      .url()
      .match(/\/notes\/([^/]+)(\/restore)?$/)!;
    const isRestore = !!match[2];
    await new Promise<void>((resolve) => (isRestore ? restores : removals).push(resolve));
    if (isRestore) deleted.delete(match[1]!);
    else deleted.add(match[1]!);
    await route.fulfill({
      json: isRestore
        ? { restored: true, cardsRestored: 1, cardsRemainingDeleted: 0 }
        : { deleted: true },
    });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Select notes', exact: true }).click();
  await expect(page.getByRole('button', { name: /Question 1 Answer 1 Known/ })).toBeVisible();
  await page.getByRole('button', { name: 'Exit selection', exact: true }).click();
  for (let n = 0; n < 10; n++)
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Question \d/ })).toHaveCount(0);
  await expect.poll(() => removals.length).toBe(10);
  removals.reverse().forEach((release) => release());
  await expect.poll(() => deleted.size).toBe(10);
  await page.goto('/library/deleted');
  await page
    .getByRole('radiogroup', { name: 'Deleted content' })
    .locator('label')
    .filter({ hasText: 'Notes' })
    .click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(10);
  const readsBefore = recoveryReads;
  for (let n = 0; n < 10; n++)
    await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
  await expect.poll(() => restores.length).toBe(10);
  restores.reverse().forEach((release) => release());
  await expect.poll(() => deleted.size).toBe(0);
  await page.goto(`/notes?deckId=${deck.id}`);
  await expect(page.getByRole('button', { name: /Question \d/ })).toHaveCount(10);
  expect(recoveryReads - readsBefore).toBeLessThanOrEqual(1);
});

test('practice repeats only still-learning notes and sends no writes', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [deck] } }));
  await page.route('**/api/notes?**', (route) =>
    route.fulfill({ json: { items: notes.slice(0, 2) } }),
  );
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Practice', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: 'Still learning', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: 'Know', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat still learning', exact: true }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: 'Know', exact: true }).click();
  await expect(page.getByText('100% cleared this practice run', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('caught-up Today state explains when the next review returns', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [{ ...deck, due: 0, fresh: 0 }], notes: [] });
  await page.route('**/api/study/session', (route) =>
    route.fulfill({
      json: {
        cards: [],
        notes: [],
        nextDue: '2026-09-17T09:00:00.000Z',
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
          marginalCost: 0,
          reason: 'dailyCapReached',
          overrideAvailable: false,
          limitedBy: 'noNewCards',
        },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('You are caught up', { exact: true })).toBeVisible();
  await expect(page.getByText(/Next scheduled review:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeDisabled();
});

test('a committed touch swipe deletes on release without a second tap', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes });
  let deleted = 0;
  await page.route(`**/api/notes/${notes[0]!.id}`, (route) => {
    deleted += 1;
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  const row = page.getByRole('button', { name: /Question 1 Answer 1/ }).first();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(row).toHaveCount(0);
  await expect.poll(() => deleted).toBe(1);
  await expect(page.locator('[data-swipe-action]')).toHaveCount(0);
});

test('a committed touch pointer swipe deletes on release', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'Synthetic touch pointer fidelity is checked in WebKit.');
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes });
  const removed = new Set<string>();
  await page.route('**/api/notes?**', (route) =>
    route.fulfill({ json: { items: notes.filter((note) => !removed.has(note.id)) } }),
  );
  let deleted = 0;
  await page.route(`**/api/notes/${notes[0]!.id}`, (route) => {
    deleted += 1;
    removed.add(notes[0]!.id);
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  const row = page.getByRole('button', { name: /Question 1 Answer 1/ }).first();
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 330, clientY: 150 });
  await row.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 90, clientY: 151 });
  await row.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 90, clientY: 151 });
  await expect.poll(() => deleted).toBe(1);
  await expect(row).toHaveCount(0);
  await expect(page.locator('[data-direct-delete]')).toHaveCount(9);
});

test('handle drag places a child at the exact root insertion point in one request', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const folder = {
    ...deck,
    id: id(200),
    name: 'Folder',
    kind: 'folder',
    children: [{ ...deck, parentId: id(200), path: [id(200)] }],
  };
  const other = { ...deck, id: id(300), name: 'Root anchor', position: 1 };
  let treeReads = 0;
  await page.route('**/api/decks', (route) => {
    treeReads += 1;
    return route.fulfill({ json: { decks: [folder, other] } });
  });
  const moves: unknown[] = [];
  await page.route('**/api/decks/*/move', (route) => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ json: { deck } });
  });
  await page.goto('/library');
  await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Drag Practice deck', exact: true });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + 22);
  const target = page.locator(`[data-drop-target="before:${other.id}"]`);
  await expect(target).toBeVisible();
  const end = (await target.boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => moves).toEqual([{ parentId: null, beforeId: other.id }]);
  await expect.poll(() => treeReads).toBeGreaterThan(1);
});

async function setupNestedDragTree(page: Page) {
  const folderAId = id(220);
  const folderBId = id(230);
  const first = {
    ...deck,
    id: id(221),
    name: 'First child',
    parentId: folderAId,
    path: [folderAId],
    position: 0,
  };
  const second = {
    ...deck,
    id: id(222),
    name: 'Second child',
    parentId: folderAId,
    path: [folderAId],
    position: 1,
  };
  const folderA = {
    ...deck,
    id: folderAId,
    name: 'Folder A',
    kind: 'folder',
    children: [first, second],
    position: 0,
  };
  const folderB = {
    ...deck,
    id: folderBId,
    name: 'Folder B',
    kind: 'folder',
    children: [],
    position: 1,
  };
  let treeReads = 0;
  await page.route('**/api/decks', (route) => {
    treeReads += 1;
    return route.fulfill({ json: { decks: [folderA, folderB] } });
  });
  const moves: unknown[] = [];
  await page.route('**/api/decks/*/move', (route) => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ json: { deck } });
  });
  await page.goto('/library');
  await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();

  return { first, second, folderAId, folderBId, moves, treeReads: () => treeReads };
}

test('drag target reorders nested siblings at an exact position', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const { first, folderAId, moves, treeReads } = await setupNestedDragTree(page);

  await dragWithMouse(page, 'Drag Second child', `before:${first.id}`);
  await expect.poll(() => moves.at(-1)).toEqual({ parentId: folderAId, beforeId: first.id });
  await expect.poll(treeReads).toBeGreaterThan(1);
  expect(moves).toHaveLength(1);
});

test('drag target places a child inside another folder', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const { folderBId, moves, treeReads } = await setupNestedDragTree(page);

  await dragWithMouse(page, 'Drag First child', `inside:${folderBId}`);
  await expect.poll(() => moves.at(-1)).toEqual({ parentId: folderBId, beforeId: null });
  await expect.poll(treeReads).toBeGreaterThan(1);
  expect(moves).toHaveLength(1);
});

test('touch handle drag keeps the exact insertion target', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  const folder = {
    ...deck,
    id: id(210),
    name: 'Folder',
    kind: 'folder',
    children: [{ ...deck, parentId: id(210), path: [id(210)] }],
  };
  const other = { ...deck, id: id(310), name: 'Root anchor', position: 1 };
  let treeReads = 0;
  await page.route('**/api/decks', (route) => {
    treeReads += 1;
    return route.fulfill({ json: { decks: [folder, other] } });
  });
  const moves: unknown[] = [];
  await page.route('**/api/decks/*/move', (route) => {
    moves.push(route.request().postDataJSON());
    return route.fulfill({ json: { deck } });
  });
  await page.goto('/library');
  await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Drag Practice deck', exact: true });
  await expect(handle).toHaveCSS('touch-action', 'none');
  await expect(page.getByRole('button', { name: 'Folder', exact: true })).not.toHaveCSS(
    'touch-action',
    'none',
  );
  const start = (await handle.boundingBox())!;
  await handle.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: start.x + 22,
    clientY: start.y + 22,
  });
  await page.evaluate(
    ({ x, y }) => {
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          buttons: 1,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x: start.x + 30, y: start.y + 22 },
  );
  const target = page.locator(`[data-drop-target="before:${other.id}"]`);
  await expect(target).toBeVisible();
  const end = (await target.boundingBox())!;
  await page.evaluate(
    ({ x, y }) => {
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          buttons: 1,
          clientX: x,
          clientY: y,
        }),
      );
      document.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          buttons: 0,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x: end.x + end.width / 2, y: end.y + end.height / 2 },
  );
  await expect.poll(() => moves).toEqual([{ parentId: null, beforeId: other.id }]);
  await expect.poll(() => treeReads).toBeGreaterThan(1);
});
