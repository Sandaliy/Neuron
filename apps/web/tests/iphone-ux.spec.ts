import { expect, test } from '@playwright/test';

import { useFixtures as stubApi, usePreferences as setPreferences } from './fixtures';

import type { Page } from '@playwright/test';

async function setup(page: Page, locale: 'en' | 'ru' = 'en') {
  await setPreferences(page, { theme: locale === 'ru' ? 'light' : 'dark', locale, glass: 'off' });
  await stubApi(page);
  let note = {
    id: 'mobile',
    deckId: 'd1',
    noteType: 'vocab',
    fields: { term: 'lernen', translation: 'learn' },
    tags: [] as string[],
    status: 'active',
  };
  const control = {
    delay: 0,
    fail: false,
    patches: [] as Record<string, unknown>[],
    statuses: [] as string[],
    active: 0,
    peak: 0,
    reads: 0,
  };
  await page.route('**/api/notes/mobile', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      control.patches.push(body);
      control.peak = Math.max(control.peak, ++control.active);
      await new Promise((resolve) => setTimeout(resolve, control.delay));
      control.active--;
      if (control.fail) return route.abort('failed');
      note = { ...note, ...body };
    } else control.reads++;
    return route.fulfill({
      json: {
        note,
        cards: [{ id: 'card', direction: 'recognition', slot: 0, reps: 0, state: 'new' }],
      },
    });
  });
  await page.route('**/api/notes/status', async (route) => {
    const { status } = route.request().postDataJSON();
    control.statuses.push(status);
    await new Promise((resolve) => setTimeout(resolve, control.delay));
    if (control.fail) return route.abort('failed');
    note = { ...note, status };
    return route.fulfill({ json: { changed: 1 } });
  });
  await page.route('**/api/notes?**', (route) => route.fulfill({ json: { items: [note] } }));
  return { control, stored: () => note };
}

test('slow autosave drains newer edits without moving the focused field or refetching it', async ({
  page,
}) => {
  const { control, stored } = await setup(page);
  control.delay = 1200;
  await page.goto('/notes/mobile');
  const field = page.getByRole('textbox', { name: 'Translation', exact: true });
  await field.fill('first edit');
  const initial = await field.boundingBox();
  await expect.poll(() => control.patches.length).toBe(1);
  await field.fill('latest edit');
  await expect(field).toBeFocused();
  await expect.poll(() => stored().fields.translation).toBe('latest edit');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(control.peak).toBe(1);
  expect(control.reads).toBe(1);
  expect(Math.abs((await field.boundingBox())!.y - initial!.y)).toBeLessThanOrEqual(1);
  await expect(field).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('editor-mobile.png'), fullPage: true });
});

test('failed autosave keeps the draft, reports failure and retries without a global toast', async ({
  page,
}) => {
  const { control, stored } = await setup(page);
  await page.goto('/notes/mobile');
  control.fail = true;
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('retained');
  const retry = page.getByRole('button', { name: /Not saved/ });
  await expect(retry).toBeVisible();
  expect(stored().fields.translation).toBe('learn');
  await expect(page.locator('[data-g="toast"]')).toHaveCount(0);
  control.fail = false;
  await retry.click();
  await expect.poll(() => stored().fields.translation).toBe('retained');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('navigation flushes a pending draft before leaving the editor', async ({ page }) => {
  const { control, stored } = await setup(page);
  control.delay = 1500;
  await page.goto('/notes/mobile');
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('before leaving');
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/, { timeout: 700 });
  await expect.poll(() => stored().fields.translation, { timeout: 2500 }).toBe('before leaving');
});

test('Known responds immediately, rejects repeated taps and rolls back on failure', async ({
  page,
}) => {
  const { control } = await setup(page);
  control.delay = 1500;
  await page.goto('/notes/mobile');
  const mark = page.getByRole('button', { name: 'Mark as known', exact: true });
  await mark.click();
  await expect(page.getByRole('status').filter({ hasText: /^Known$/ })).toBeVisible({
    timeout: 500,
  });
  const again = page.getByRole('button', { name: 'Study it again', exact: true });
  await expect(again).toBeDisabled();
  await again.evaluate((button: HTMLButtonElement) => {
    for (let i = 0; i < 5; i++) button.click();
  });
  await expect(again).toBeEnabled();
  expect(control.statuses).toEqual(['known']);
  control.fail = true;
  await again.click();
  await expect(page.getByRole('status').filter({ hasText: /^Being studied$/ })).toBeVisible({
    timeout: 500,
  });
  await expect(again).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: /^Known$/ })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('empty decks hide browse controls; selection actions stay in the page and offer both status directions', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/notes?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/notes?deckId=d1');
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await page.unroute('**/api/notes?**');
  await stubApi(page);
  await page.reload();
  await page.getByRole('button', { name: 'Select notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit selection', exact: true })).toBeVisible();
  await page.locator('[data-row]').first().click();
  await expect(page.getByText('Selected: 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit tags', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move to a deck', exact: true })).toBeVisible();
  const first = await page.locator('[data-row]').first().boundingBox();
  const actions = await page
    .getByRole('button', { name: 'Delete them', exact: true })
    .boundingBox();
  expect(first!.y).toBeGreaterThanOrEqual(actions!.y + actions!.height);
  await page.screenshot({ path: test.info().outputPath('selection-mobile.png'), fullPage: true });
});

for (const locale of ['en', 'ru'] as const) {
  test(`import explains fields, adds separate word/translation and previews cloze in ${locale}`, async ({
    page,
  }) => {
    await setup(page, locale);
    await page.route('**/api/notes/duplicates', (route) =>
      route.fulfill({ json: { matches: [] } }),
    );
    await page.goto('/import?deckId=d1');
    await page
      .getByRole('textbox', { name: locale === 'en' ? 'Word' : 'Слово', exact: true })
      .fill('Haus');
    await page
      .getByRole('textbox', { name: locale === 'en' ? 'Translation' : 'Перевод', exact: true })
      .fill('house');
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Add to the list' : 'Добавить в список',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: locale === 'en' ? 'Read the list' : 'Прочитать список' })
      .click();
    await expect(page.locator('[data-import-row]')).toContainText('Haus');
    await expect(page.locator('[data-import-row]')).toContainText('house');
    await page.goto('/import?deckId=d1');
    await page
      .getByRole('combobox', { name: locale === 'en' ? 'Note type' : 'Тип заметки', exact: true })
      .selectOption('cloze');
    await page.locator('textarea').fill('Ich {{lerne}} Deutsch.');
    await page
      .getByRole('button', { name: locale === 'en' ? 'Read the list' : 'Прочитать список' })
      .click();
    await page
      .locator('summary')
      .filter({ hasText: locale === 'en' ? 'Cards from' : 'Карточки первой' })
      .click();
    await expect(page.getByText('Ich [...] Deutsch.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`cloze-${locale}.png`), fullPage: true });
  });
}

test('Safari toolbar measurements do not move the fixed bar; blur restores it after stale keyboard geometry', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/notes/mobile');
  const nav = page.locator('[data-g="tabbar"]');
  const original = await nav.boundingBox();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      value: innerHeight - 180,
    });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(nav).toBeVisible();
  expect((await nav.boundingBox())!.y).toBe(original!.y);
  await page.getByRole('textbox', { name: 'Translation', exact: true }).focus();
  await expect(nav).toBeHidden();
  await page.getByRole('textbox', { name: 'Translation', exact: true }).blur();
  await expect(nav).toBeVisible();
  expect((await nav.boundingBox())!.y).toBe(original!.y);
});
