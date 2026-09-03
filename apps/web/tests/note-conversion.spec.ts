import { expect, test } from '@playwright/test';

import { useFixtures as stubApi, usePreferences as setPreferences } from './fixtures';

import type { Page } from '@playwright/test';

async function editor(
  page: Page,
  options: { source?: 'basic' | 'vocab'; reviewed?: boolean; locale?: 'en' | 'ru' } = {},
) {
  await setPreferences(page, {
    theme: options.locale === 'ru' ? 'light' : 'dark',
    locale: options.locale ?? 'en',
    glass: 'off',
  });
  await stubApi(page);
  let stored = {
    note: {
      id: 'conversion',
      deckId: 'd1',
      noteType: options.source ?? 'vocab',
      fields: (options.source === 'basic'
        ? { front: 'Old question', back: 'Old answer' }
        : { term: 'Sorgfalt', translation: 'care' }) as Record<string, unknown>,
      tags: ['kept'],
      source: 'lesson',
      rank: 0,
      status: 'active',
      importBatchId: null,
      rev: 1,
    },
    cards: [{ id: 'old-card', direction: 'recognition', slot: 0, reps: options.reviewed ? 1 : 0 }],
  };
  const writes: Record<string, unknown>[] = [];
  const control = { fail: false, answeredOnServer: false };
  await page.route('**/api/notes/conversion', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (control.fail) return route.abort('failed');
      if (control.answeredOnServer && !body['discardCards'])
        return route.fulfill({
          status: 409,
          json: { error: { code: 'cards_would_be_lost', status: 409, correlationId: 'test' } },
        });
      stored = {
        note: { ...stored.note, ...body, rev: stored.note.rev + 1 },
        cards: body['noteType']
          ? [
              {
                id: 'new-card',
                direction: body['noteType'] === 'cloze' ? 'cloze' : 'recognition',
                slot: body['noteType'] === 'cloze' ? 1 : 0,
                reps: 0,
              },
            ]
          : stored.cards,
      };
    }
    return route.fulfill({ json: stored });
  });
  await page.goto('/notes/conversion');
  await expect(page.getByRole('radiogroup')).toBeVisible();
  return { writes, control, stored: () => stored };
}

for (const target of ['basic', 'vocab', 'cloze'] as const) {
  test(`valid empty ${target} draft, explicit apply, then same-type autosave`, async ({ page }) => {
    const state = await editor(page, { source: target === 'vocab' ? 'basic' : 'vocab' });
    await page
      .getByRole('radio', {
        name: { basic: 'Question', vocab: 'Word', cloze: 'Gap text' }[target],
        exact: true,
      })
      .press('Space');
    const apply = page.getByRole('button', { name: 'Apply type change', exact: true });
    await expect(apply).toBeDisabled();
    const fields =
      target === 'basic'
        ? { Front: 'New question', Back: 'New answer' }
        : target === 'vocab'
          ? { Word: 'Neu', Translation: 'new' }
          : { Text: 'A {{gap}}.' };
    for (const label of Object.keys(fields))
      await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue('');
    if (target === 'cloze') {
      await page.getByRole('textbox', { name: 'Text', exact: true }).fill('No gap');
      await expect(apply).toBeDisabled();
    }
    for (const [label, value] of Object.entries(fields))
      await page.getByRole('textbox', { name: label, exact: true }).fill(value);
    await expect(apply).toBeEnabled();
    await page.waitForTimeout(900);
    expect(state.writes).toEqual([]);
    await expect(page.getByText('Goes', { exact: true })).toBeVisible();
    await expect(page.getByText('New', { exact: true })).toBeVisible();
    await apply.focus();
    await expect(apply).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(apply).toHaveCount(0);
    expect(state.writes).toEqual([
      {
        noteType: target,
        fields: Object.fromEntries(
          Object.entries(fields).map(([name, value]) => [
            name === 'Word' ? 'term' : name.toLowerCase(),
            value,
          ]),
        ),
      },
    ]);
    expect(state.stored().note.tags).toEqual(['kept']);
    const first = page.getByRole('textbox', { name: Object.keys(fields)[0]!, exact: true });
    await first.fill(target === 'cloze' ? 'Another {{gap}}.' : 'Ordinary correction');
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1]).not.toHaveProperty('noteType');
  });
}

test('cancel and switching back do not persist drafts; ordinary fields and tags still autosave', async ({
  page,
}) => {
  const state = await editor(page);
  const before = structuredClone(state.stored());
  await page.getByRole('radio', { name: 'Question', exact: true }).press('Space');
  await page.getByRole('textbox', { name: 'Front', exact: true }).fill('Discard draft');
  await page.getByRole('button', { name: 'Cancel type change' }).click();
  await expect(page.getByRole('radio', { name: 'Word', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue('Sorgfalt');
  await page.getByRole('radio', { name: 'Gap text' }).press('Space');
  await page.getByRole('radio', { name: 'Word', exact: true }).press('Space');
  await page.waitForTimeout(900);
  expect(state.stored()).toEqual(before);
  expect(state.writes).toEqual([]);
  await page.getByRole('textbox', { name: 'Translation', exact: true }).fill('thoroughness');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('kept, new-tag');
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toEqual({
    fields: { term: 'Sorgfalt', translation: 'thoroughness' },
    tags: ['kept', 'new-tag'],
  });
});

for (const locale of ['en', 'ru'] as const) {
  test(`answered cards require confirmation with truthful history copy in ${locale}`, async ({
    page,
  }) => {
    const state = await editor(page, { reviewed: true, locale });
    await page
      .getByRole('radio', { name: locale === 'en' ? 'Question' : 'Вопрос', exact: true })
      .press('Space');
    const boxes = page.locator('fieldset').first().getByRole('textbox');
    await boxes.nth(0).fill('New question');
    await boxes.nth(1).fill('New answer');
    const apply = page.getByRole('button', {
      name: locale === 'en' ? 'Apply type change' : 'Применить смену типа',
      exact: true,
    });
    await apply.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      locale === 'en' ? 'past reviews stay in history' : 'повторы останутся в истории',
    );
    expect(state.writes).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(apply).toBeFocused();
    await apply.click();
    await page.screenshot({
      path: test.info().outputPath(`conversion-${locale}.png`),
      animations: 'disabled',
    });
    const rect = await dialog.boundingBox();
    expect(rect!.height).toBeLessThan(page.viewportSize()!.height);
    await dialog
      .getByRole('button', {
        name: locale === 'en' ? 'Replace cards and change type' : 'Заменить карточки и сменить тип',
      })
      .click();
    await expect(apply).toHaveCount(0);
    expect(state.writes[0]).toMatchObject({
      discardCards: true,
      noteType: 'basic',
      fields: { front: 'New question', back: 'New answer' },
    });
  });
}

test('failed conversion retains original data and a recoverable draft', async ({ page }) => {
  const state = await editor(page);
  const before = structuredClone(state.stored());
  await page.getByRole('radio', { name: 'Question', exact: true }).press('Space');
  await page.getByRole('textbox', { name: 'Front', exact: true }).fill('New question');
  await page.getByRole('textbox', { name: 'Back', exact: true }).fill('New answer');
  state.control.fail = true;
  await page.getByRole('button', { name: 'Apply type change', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(state.stored()).toEqual(before);
  await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toHaveValue(
    'New question',
  );
  await page.waitForTimeout(900);
  expect(state.writes).toHaveLength(1);
  state.control.fail = false;
  await page.getByRole('button', { name: 'Apply type change', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply type change', exact: true })).toHaveCount(0);
  expect(state.writes[1]).toEqual(state.writes[0]);
});

test('a newer server-side answer still requires explicit discard confirmation', async ({
  page,
}) => {
  const state = await editor(page);
  await page.getByRole('radio', { name: 'Question', exact: true }).press('Space');
  await page.getByRole('textbox', { name: 'Front', exact: true }).fill('New question');
  await page.getByRole('textbox', { name: 'Back', exact: true }).fill('New answer');
  state.control.answeredOnServer = true;
  await page.getByRole('button', { name: 'Apply type change', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.stored().note.noteType).toBe('vocab');
  expect(state.writes[0]).not.toHaveProperty('discardCards');
  await page.getByRole('button', { name: 'Replace cards and change type' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => state.stored().note.noteType).toBe('basic');
  expect(state.writes[1]).toHaveProperty('discardCards', true);
});
