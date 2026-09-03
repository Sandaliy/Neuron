import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

for (const locale of ['en', 'ru'] as const) {
  test(`duplicate defaults, exceptions and undo boundary in ${locale}`, async ({ page }) => {
    await usePreferences(page, { theme: locale === 'en' ? 'dark' : 'light', locale, glass: 'off' });
    await useFixtures(page);
    const matches = [
      { term: 'unique', noteId: 'unique', noteType: 'vocab' },
      { term: 'mixed', noteId: 'wrong-type', noteType: 'basic' },
      { term: 'mixed', noteId: 'right-type', noteType: 'vocab' },
      { term: 'ambiguous', noteId: 'a', noteType: 'vocab' },
      { term: 'ambiguous', noteId: 'b', noteType: 'vocab' },
      { term: 'incompatible', noteId: 'basic', noteType: 'basic' },
    ].map((match) => ({ ...match, deckId: 'd1', written: match.term }));
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    await page.route('**/api/notes/duplicates', (route) => route.fulfill({ json: { matches } }));
    await page.route('**/api/imports**', async (route) => {
      if (route.request().method() === 'POST')
        writes.push({
          path: new URL(route.request().url()).pathname,
          body: route.request().postDataJSON(),
        });
      await route.fulfill({ json: { notes: 2, cards: 2, reviewedCards: 0 } });
    });
    await page.route('**/api/notes/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      await route.fulfill({ json: {} });
    });
    await page.goto('/import?deckId=d1');
    await page.locator('textarea').fill(
      JSON.stringify({
        noteType: 'vocab',
        notes: ['unique', 'mixed', 'ambiguous', 'incompatible', 'fresh'].map((term) => ({
          term,
          translation: 'meaning',
        })),
      }),
    );
    await page
      .getByRole('button', { name: locale === 'en' ? 'Read the list' : 'Прочитать список' })
      .click();
    const defaultChoice = page.getByLabel(
      locale === 'en' ? 'Default for duplicates' : 'По умолчанию для совпадений',
      { exact: true },
    );
    await defaultChoice.selectOption('merge');
    const row = (term: string) =>
      page.locator('[data-import-row]').filter({ has: page.getByText(term, { exact: true }) });
    await expect(row('ambiguous')).toContainText(
      locale === 'en' ? 'Several matching notes' : 'Найдено несколько',
    );
    await row('ambiguous').locator('select').focus();
    await expect(row('ambiguous').locator('select')).toBeFocused();
    expect((await row('ambiguous').locator('select').boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
    await page.screenshot({ path: test.info().outputPath(`import-${locale}.png`), fullPage: true });
    await expect(row('incompatible')).toContainText(
      locale === 'en' ? 'another note type' : 'другой тип',
    );
    await expect(row('ambiguous').locator('option[value=merge]')).toBeDisabled();
    await expect(row('mixed').locator('option[value=merge]')).toBeEnabled();
    await row('unique').locator('select').selectOption('skip');
    await row('ambiguous').locator('select').selectOption('create');
    await expect(row('ambiguous')).toContainText(
      locale === 'en' ? 'overrides the import default' : 'выбрано отдельное',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page
      .getByRole('button', { name: locale === 'en' ? /^Import 3/ : /^Импортировать записей: 3/ })
      .click();
    await expect(
      page.getByText(locale === 'en' ? 'Imported' : 'Импортировано', { exact: true }),
    ).toBeVisible();
    const patches = writes.filter((write) => write.path.startsWith('/api/notes/'));
    expect(patches).toEqual([
      {
        path: '/api/notes/right-type',
        body: { merge: true, noteType: 'vocab', fields: { term: 'mixed', translation: 'meaning' } },
      },
    ]);
    const chunk = writes.find((write) => write.path.endsWith('/notes'))!.body['notes'] as {
      fields: { term: string };
    }[];
    expect(chunk.map((note) => note.fields.term)).toEqual(['ambiguous', 'fresh']);
    await expect(
      page.getByText(
        locale === 'en'
          ? /Additions to existing notes stay/
          : /Дополнения к существующим записям останутся/,
      ),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: locale === 'en' ? 'Take this import back' : 'Откатить этот импорт',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      locale === 'en' ? 'Review history is kept' : 'История ответов сохранится',
    );
  });
}

test('lost chunk response resumes with the original IDs and does not duplicate rows', async ({
  page,
}) => {
  await usePreferences(page, { theme: 'dark', locale: 'en' });
  await useFixtures(page);
  const attempts: string[][] = [];
  const accepted = new Set<string>();
  await page.route('**/api/imports**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/notes')) {
      const rows = route.request().postDataJSON().notes as { id: string }[];
      attempts.push(rows.map((row) => row.id));
      rows.forEach((row) => accepted.add(row.id));
      if (attempts.length === 1) return route.abort('failed');
    }
    await route.fulfill({ json: { notes: accepted.size, cards: accepted.size } });
  });
  await page.goto('/import?deckId=d1');
  await page.locator('textarea').fill(
    JSON.stringify({
      noteType: 'vocab',
      notes: [
        { term: 'one', translation: 'first' },
        { term: 'two', translation: 'second' },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Read the list' }).click();
  await page.getByRole('button', { name: /^Import 2/ }).click();
  await page.getByRole('button', { name: 'Carry on from where it stopped' }).click();
  await expect(page.getByText('Imported', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(accepted.size).toBe(2);
});
