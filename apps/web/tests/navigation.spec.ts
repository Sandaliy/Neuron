import { expect, test } from '@playwright/test';

import { advancePractice } from '@neuron/shared';
import type { PracticeRun } from '@neuron/shared';

import { manyDecks, useFixtures, usePreferences, waitForPracticeSave } from './fixtures';

import type { Page } from '@playwright/test';

async function expectTab(page: Page, name: string) {
  const bar = page.locator('[data-g="tabbar"]');
  await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
  const tab = bar.getByRole('link', { name, exact: true });
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(async () => {
      const pill = await bar.locator('[data-slot="tab-pill"]').boundingBox();
      const target = await tab.boundingBox();
      return Math.abs(pill!.x + pill!.width / 2 - target!.x - target!.width / 2);
    })
    .toBeLessThanOrEqual(1);
}

for (const theme of ['dark', 'light']) {
  test(`tabs follow direct destinations, nested screens and history in ${theme}`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme });
    await useFixtures(page);
    await page.route('**/api/decks/*/practice', (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.route('**/api/notes/n1', (route) =>
      route.fulfill({ json: { note: { ...words[0], id: 'n1', deckId: 'd3' }, cards: [] } }),
    );
    for (const [path, name, heading] of [
      ['/', 'Today', 'Today'],
      ['/settings', 'Settings', 'Settings'],
      ['/library', 'Library', 'Library'],
      ['/library?folderId=d1', 'Library', 'Deutsch'],
      ['/library/deleted', 'Library', 'Deleted'],
      ['/notes?deckId=d3', 'Library', 'Verben mit Dativ'],
      ['/notes/n1', 'Library', 'Note'],
      ['/notes/new?deckId=d3', 'Library', 'New note'],
      ['/import?deckId=d3', 'Library', 'Import'],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expectTab(page, name);
      if (path.startsWith('/import') || path === '/notes?deckId=d3') {
        await page.screenshot({
          path: info.outputPath(`${theme}-${path.startsWith('/import') ? 'import' : 'notes'}.png`),
          animations: 'disabled',
        });
      }
    }
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expectTab(page, 'Today');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expectTab(page, 'Settings');
    await page.goBack();
    await expectTab(page, 'Today');
    await page.goBack();
    await expectTab(page, 'Library');
    await page.goForward();
    await expectTab(page, 'Today');
  });
}

test('new destinations start at the top and history restores the Library position', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark', glass: 'off' });
  await useFixtures(page, { decks: manyDecks(80) });
  await page.goto('/library');
  await expect(page.getByRole('button', { name: 'Deck 1', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);
});

test('rapid tab changes settle on the visible destination', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page);
  await page.goto('/library');
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const name of ['Settings', 'Library', 'Today']) {
      await page
        .getByRole('link', { name, exact: true })
        .evaluate((link: HTMLAnchorElement) => link.click());
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expectTab(page, 'Today');
  }
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expectTab(page, 'Settings');
});

const stamp = '2026-01-01T00:00:00.000Z';
const deckId = '01900000-0000-7000-8000-000000000901';
const leaf = {
  id: deckId,
  name: 'Words',
  kind: 'deck',
  parentId: 'folder',
  path: ['folder'],
  children: [],
  due: 0,
  fresh: 2,
  noteCount: 2,
  settings: null,
};
const folder = {
  ...leaf,
  id: 'folder',
  name: 'German',
  kind: 'folder',
  parentId: null,
  path: [],
  children: [leaf],
};
const words = [1, 2].map((n) => ({
  id: `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  deckId,
  noteType: 'vocab' as const,
  fields: { term: `Wort ${n}`, translation: `Word ${n}` },
  tags: [],
  status: 'active' as const,
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
}));

test('nested Back actions clear menus and pending edits reach the same Deck', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [folder], notes: words });
  let saved = words[0]!;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/notes/${saved.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      await pending;
      saved = { ...saved, ...body };
    }
    await route.fulfill({ json: { note: saved, cards: [] } });
  });
  await page.goto('/library');
  await page.getByRole('button', { name: /^German Decks:/ }).click();
  await page.getByRole('button', { name: 'Actions for Words', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('[data-pressed]')).toHaveCount(0);
  await page.getByRole('button', { name: /^German Decks:/ }).click();
  await page.getByRole('button', { name: /^Words 2 notes/ }).click();
  await page.locator('[data-row]').first().click();
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('Kept edit');
  await page.getByRole('button', { name: 'Words', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Words', exact: true })).toBeVisible();
  await expectTab(page, 'Library');
  release();
  await expect.poll(() => saved.fields.translation).toBe('Kept edit');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expectTab(page, 'Library');
  await page.getByRole('button', { name: 'Words', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notes\\?deckId=${deckId}$`));
  await page.getByRole('button', { name: 'German', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test('new Note drafts survive cancelled tab and history navigation', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [folder], notes: words });
  await page.goto(`/notes?deckId=${deckId}`);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const term = page.getByRole('textbox', { name: 'Word', exact: true });
  await term.fill('Behalten');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(term).toHaveValue('Behalten');
  await expectTab(page, 'Library');
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(term).toHaveValue('Behalten');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expectTab(page, 'Settings');
});

test('saving a new Note leaves the draft without a discard prompt', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [folder], notes: words });
  let saved = words[0]!;
  await page.route('**/api/notes', (route) => {
    saved = { ...saved, ...route.request().postDataJSON() };
    return route.fulfill({ json: { note: saved, cards: [] } });
  });
  await page.route(/\/api\/notes\/[^/?]+$/, (route) =>
    route.fulfill({ json: { note: saved, cards: [] } }),
  );
  await page.goto(`/notes/new?deckId=${deckId}`);
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Gespeichert');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('Saved');
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${saved.id}$`));
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('Gespeichert');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectTab(page, 'Library');
});

test('failed autosaves and unapplied conversions retain their drafts when navigation is cancelled', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useFixtures(page, { decks: [folder], notes: words });
  let saved = words[0]!;
  let fail = true;
  await page.route(`**/api/notes/${saved.id}`, (route) => {
    if (route.request().method() === 'PATCH') {
      if (fail) return route.fulfill({ status: 500, json: { error: { code: 'internal_error' } } });
      saved = { ...saved, ...route.request().postDataJSON() };
    }
    return route.fulfill({ json: { note: saved, cards: [] } });
  });
  await page.goto(`/notes/${saved.id}`);
  const translation = page.getByRole('textbox', { name: 'Translation', exact: true });
  await translation.fill('Retained after failure');
  await expect(page.getByRole('button', { name: /Not saved/ })).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(translation).toHaveValue('Retained after failure');
  fail = false;
  await page.getByRole('button', { name: /Not saved/ }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Question', exact: true }).press('Space');
  await page.getByRole('textbox', { name: 'Front', exact: true }).fill('Unapplied question');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toHaveValue(
    'Unapplied question',
  );
  expect(saved.fields.translation).toBe('Retained after failure');
  expect(saved.noteType).toBe('vocab');
});

test('Practice returns to the Deck position and resumes classified progress after switching tabs', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  const pool = Array.from({ length: 30 }, (_, index) => ({
    ...words[index % 2]!,
    id: `01900000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
    fields: { term: `Wort ${index + 1}`, translation: `Word ${index + 1}` },
  }));
  await useFixtures(page, { decks: [folder], notes: pool });
  let run: PracticeRun | null = null;
  let version = 0;
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname);
  });
  await page.route(`**/api/decks/${deckId}/practice`, (route) => {
    if (route.request().method() === 'POST') {
      run = advancePractice(run, route.request().postDataJSON(), pool);
      version++;
    }
    return route.fulfill({ json: { run, version } });
  });
  await page.goto(`/notes?deckId=${deckId}`);
  const start = page.getByRole('button', { name: 'Start practice', exact: true });
  await expect(start).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 160));
  await start.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => window.scrollY);
  expect(position).toBeGreaterThan(0);
  await start.click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.locator('[data-learning-screen]')).toBeVisible();
  await expect(page.locator('[data-g="tabbar"]')).toBeHidden();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await waitForPracticeSave(page);
  await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Words', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position);
  await expectTab(page, 'Library');
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expectTab(page, 'Today');
  await page.goBack();
  await page.getByRole('button', { name: 'Resume practice', exact: true }).click();
  await expect(page.getByText('Wort 2', { exact: true })).toBeVisible();
  expect(run?.statuses[words[0]!.id]).toBe('known');
  expect(
    writes.every((path) => path.endsWith('/practice') || path.endsWith('/study/session')),
  ).toBe(true);
});

test('Study completion returns to Today with the correct tab', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useFixtures(page);
  const session = page.waitForResponse('**/api/study/session');
  await page.goto('/');
  const plan = await (await session).json();
  await page.route('**/api/reviews', (route) =>
    route.fulfill({
      json: {
        card: { ...plan.cards[0], state: 'review', reps: 1, due: '2027-01-01T00:00:00.000Z' },
      },
    }),
  );
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.locator('[data-g="tabbar"]')).toBeHidden();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expectTab(page, 'Today');
});
