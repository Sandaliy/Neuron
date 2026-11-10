import { expect, test } from '@playwright/test';

import { installQualityFixture, qualityDeckId, qualityDownloaded } from './content-quality-fixture';
import {
  installInteractionMetrics,
  readInteractionMetrics,
  startInteractionMetrics,
} from './interaction-metrics';
import { continuousSearch } from './search-interaction';

import type { Page } from '@playwright/test';

const check = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name} `) });

test('Library offers explicit consistency and enrichment checks with exact overlapping counts and filters', async ({
  page,
}, info) => {
  const state = await installQualityFixture(page);
  await page.goto('/library');
  await page.getByRole('button', { name: 'Checks', exact: true }).click();
  await page.getByRole('button', { name: /^Content checks / }).click();
  await expect(page.getByRole('heading', { name: 'Consistency check', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optional context', exact: true })).toBeVisible();
  await expect(page.getByText('Vocabulary Notes checked: 5500', { exact: true })).toBeVisible();
  await expect(check(page, 'Example translation without an example')).toContainText('1375');
  await expect(check(page, 'Example without a translation')).toContainText('1375');
  await expect(check(page, 'No example sentence')).toContainText('2750');
  await expect(check(page, 'No definition')).toContainText('4125');
  await page.screenshot({
    path: info.outputPath('content-checks-overview-dark.png'),
    fullPage: true,
  });
  const search = page.getByRole('searchbox', { name: 'Search vocabulary content' });
  await continuousSearch(page, search, '100%_literal');
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  await page.getByRole('combobox', { name: 'Look in' }).selectOption(qualityDeckId);
  await expect(page.getByText('Vocabulary Notes checked: 2750', { exact: true })).toBeVisible();
  await expect(check(page, 'No definition')).toContainText('1375');
  await check(page, 'Example translation without an example').click();
  await expect(page.getByText('Shown: 100 of 1375', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Matching Notes' })
      .getByText(/Example, translated:/)
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Matching Notes' })
      .getByText(/Word · Imported vocabulary/)
      .first(),
  ).toBeVisible();
  await search.fill('absent');
  await search.press('Enter');
  await expect(page.getByText('No matching Notes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All checks', exact: true }).click();
  await expect(check(page, 'No definition')).toContainText('0');
  expect(state.writes).toBe(0);
  expect(state.requests.filter(({ url }) => /\/cards|\/reviews/.test(url.pathname))).toHaveLength(
    0,
  );
});

test('bounded pages retain search, Deck, scroll and keyboard focus through editor visits and a correction', async ({
  page,
}, info) => {
  const state = await installQualityFixture(page);
  await page.goto('/library/quality');
  const search = page.getByRole('searchbox', { name: 'Search vocabulary content' });
  await search.fill('meaning');
  await search.press('Enter');
  const choice = check(page, 'No definition');
  await choice.focus();
  await choice.press('Enter');
  await expect(page.getByText('Shown: 100 of 4125', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByText('Shown: 200 of 4125', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 3300));
  let id: string | undefined;
  await expect
    .poll(async () => {
      id = await page.locator('[data-quality-id]').evaluateAll((nodes) => {
        const row = nodes.find((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.top >= 80 && bounds.bottom <= innerHeight - 100;
        }) as HTMLElement | undefined;
        row?.querySelector('button')?.focus({ preventScroll: true });
        return row?.dataset['qualityId'];
      });
      return id;
    })
    .toBeTruthy();
  const row = page.locator(`[data-quality-id="${id}"] button`);
  await row.evaluate((node) =>
    node.addEventListener(
      'click',
      () => {
        Object.assign(window, { qualityExitScroll: scrollY });
      },
      { once: true },
    ),
  );
  await row.press('Enter');
  const top = await page.evaluate(
    () => (window as unknown as { qualityExitScroll: number }).qualityExitScroll,
  );
  await expect(page.getByRole('heading', { name: 'Note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Content checks', exact: true }).click();
  await expect(search).toHaveValue('meaning');
  await expect(page.getByRole('heading', { name: 'No definition', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(top, 0);
  await expect(row).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(row).not.toBeFocused();
  await row.press('Enter');
  await page
    .getByRole('textbox', { name: 'Definition', exact: true })
    .fill('Added useful context.');
  await expect
    .poll(() => state.notes.find((note) => note.id === id)?.fields['definition'])
    .toBe('Added useful context.');
  await page.getByRole('button', { name: 'Content checks', exact: true }).click();
  await expect(page.getByText('Shown: 200 of 4124', { exact: true })).toBeVisible();
  await expect(page.locator(`[data-quality-id="${id}"]`)).toHaveCount(0);
  await expect(page.locator('[data-quality-id] button:focus')).toHaveCount(1);
  expect(await page.locator('[data-quality-id]').count()).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const requests = state.requests.filter(
    ({ url }) => url.pathname === '/api/notes/content-quality',
  );
  expect(
    requests.every(
      ({ url, method }) => method === 'GET' && url.searchParams.get('limit') === '100',
    ),
  ).toBe(true);
  expect(requests.some(({ url }) => url.searchParams.has('cursor'))).toBe(true);
  await page.screenshot({
    path: info.outputPath('content-checks-notes-dark.png'),
    fullPage: false,
  });
});

test('complete downloads inspect saved edits and pending Notes, then restore server authority and clear on account change', async ({
  page,
}, info) => {
  test.setTimeout(210_000);
  const state = await installQualityFixture(page);
  await installInteractionMetrics(page);
  await page.goto('/library/quality');
  await qualityDownloaded(page);
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await startInteractionMetrics(page);
  const started = Date.now();
  await expect(page.getByText('Offline results from this device.', { exact: true })).toBeVisible();
  await expect(check(page, 'No example sentence')).toContainText('2750');
  await check(page, 'No example sentence').click();
  await expect(page.getByText('Shown: 100 of 2750', { exact: true })).toBeVisible();
  const offlineMs = Date.now() - started;
  const metrics = await readInteractionMetrics(page);
  expect(metrics.scans['cards'] ?? 0).toBe(0);
  await info.attach('content-checks-offline-performance.json', {
    body: JSON.stringify({ offlineMs, ...metrics }),
    contentType: 'application/json',
  });
  await page.locator('[data-quality-id] button').first().click();
  await page
    .getByRole('textbox', { name: 'Example', exact: true })
    .fill('Saved example on this device.');
  await page.getByRole('button', { name: 'Content checks', exact: true }).click();
  await expect(page.getByText('Shown: 100 of 2749', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All checks', exact: true }).click();
  await expect(check(page, 'No example sentence')).toContainText('2749');
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /^Lesson B / }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Device-only context');
  await page
    .getByRole('textbox', { name: 'Translation', exact: true })
    .fill('Saved pending meaning');
  await page.getByRole('button', { name: 'Save the note', exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Checks', exact: true }).click();
  await page.getByRole('button', { name: /^Content checks / }).click();
  await expect(check(page, 'No example sentence')).toContainText('2750');
  const search = page.getByRole('searchbox', { name: 'Search vocabulary content' });
  await search.fill('Device-only context');
  await search.press('Enter');
  await check(page, 'No example sentence').click();
  await expect(
    page.getByRole('button', { name: /Device-only context Saved pending meaning/ }),
  ).toContainText('Saved on device');
  state.acceptEdits = false;
  state.offline = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText('Offline results from this device.', { exact: true })).toHaveCount(
    0,
    {
      timeout: 20_000,
    },
  );
  await expect(search).toHaveValue('Device-only context');
  await expect(page.getByText('No matching Notes', { exact: true })).toBeVisible();
  await search.fill('');
  await search.press('Enter');
  await expect(page.getByText('Shown: 100 of 2750', { exact: true })).toBeVisible();
  const lastFirstPage = state.requests
    .filter(({ url }) => url.pathname === '/api/notes/content-quality')
    .at(-1)!;
  expect(lastFirstPage.url.searchParams.has('cursor')).toBe(false);
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(page.getByText('Offline results from this device.', { exact: true })).toBeVisible();
  state.who = 'second-account';
  state.offline = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText('No vocabulary Notes in this view', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-quality-id]')).toHaveCount(0);
});

test('an incomplete download hides old counts and Notes, and reconnects to the same category', async ({
  page,
}) => {
  const state = await installQualityFixture(page, 20, false);
  await page.goto('/library/quality');
  await check(page, 'No example sentence').click();
  await expect(page.getByText('Shown: 10 of 10', { exact: true })).toBeVisible();
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(
    page.getByText('The collection download is incomplete or missing.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('[data-quality-id]')).toHaveCount(0);
  await expect(page.getByText(/^Shown:/)).toHaveCount(0);
  state.offline = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText('Shown: 10 of 10', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(state.writes).toBe(0);
});

test('long mobile content remains readable, bounded and free of horizontal overflow', async ({
  page,
}, info) => {
  const state = await installQualityFixture(page, 20);
  state.notes[2]!.fields['term'] = 'ОченьДлинноеСлово'.repeat(12);
  state.notes[2]!.fields['exampleTranslation'] = 'Подробный перевод с длинным контекстом. '.repeat(
    30,
  );
  await page.goto('/library/quality');
  await check(page, 'Example translation without an example').click();
  await expect(
    page.getByRole('list', { name: 'Matching Notes' }).getByText(/ОченьДлинноеСлово/),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('content-checks-long-content.png'),
    fullPage: false,
  });
  await page.getByRole('searchbox', { name: 'Search vocabulary content' }).fill('no match');
  await expect(page.getByText('No matching Notes', { exact: true })).toBeVisible();
});

test('a late old-account inspection response cannot replace the new account view', async ({
  page,
}) => {
  const state = await installQualityFixture(page, 20, false);
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(
    (url) =>
      url.pathname === '/api/notes/content-quality' && url.searchParams.get('search') === 'held',
    async (route) => {
      requested();
      await held;
      await route.fulfill({
        json: {
          vocabularyCount: 1,
          counts: {
            'translation-without-example': 1,
            'example-without-translation': 0,
            'missing-example': 1,
            'missing-definition': 1,
          },
          items: [],
        },
      });
    },
  );
  await page.goto('/library/quality');
  await expect(check(page, 'No example sentence')).toContainText('10');
  const search = page.getByRole('searchbox', { name: 'Search vocabulary content' });
  await search.fill('held');
  await search.press('Enter');
  await started;
  state.offline = true;
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await expect(
    page.getByText('The collection download is incomplete or missing.', { exact: false }),
  ).toBeVisible();
  state.who = 'another-reader';
  state.offline = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.getByText('No vocabulary Notes in this view', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  release();
  await expect(search).toHaveValue('');
  await expect(page.getByText('Vocabulary Notes checked: 0', { exact: true })).toBeVisible();
  await expect(check(page, 'No example sentence')).toContainText('0');
});
