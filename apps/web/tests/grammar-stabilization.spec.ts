import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

for (const [language, part, field] of [
  ['de', 'noun', 'Article'],
  ['de', 'verb', 'Präteritum'],
  ['en', 'noun', 'Countability'],
  ['en', 'verb', 'Past simple'],
] as const) {
  test(`editor exposes ${language} ${part} grammar and keeps an unsaved draft`, async ({
    page,
  }) => {
    await usePreferences(page, { theme: 'dark', locale: 'en', glass: 'off' });
    await useFixtures(page);
    let settings: Record<string, unknown> = {};
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deck = () => ({
      id: 'd5',
      kind: 'deck',
      name: 'Vocabulary',
      parentId: null,
      path: [],
      children: [],
      settings,
      due: 0,
      fresh: 0,
    });
    await page.route('**/api/decks', (route) => route.fulfill({ json: { decks: [deck()] } }));
    await page.route('**/api/decks/d5', async (route) => {
      await barrier;
      settings = route.request().postDataJSON().settings;
      await route.fulfill({ json: { deck: deck() } });
    });
    await page.goto('/notes/new?deckId=d5');
    await page.getByRole('textbox', { name: 'Word', exact: true }).fill('Draft word');
    await page.getByLabel('Part of speech', { exact: true }).selectOption(part);
    await page.getByRole('button', { name: 'Grammar', exact: true }).click();
    await expect(
      page.getByText('Choose the deck language to set up grammar for this note.'),
    ).toBeVisible();
    await page.getByLabel('Language being learned', { exact: true }).focus();
    await page.getByLabel('Language being learned', { exact: true }).selectOption(language);
    await expect(page.getByLabel(field, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Language being learned', { exact: true })).toBeFocused();
    release();
    await expect.poll(() => settings['targetLanguage']).toBe(language);
    await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue(
      'Draft word',
    );
    await page.getByLabel('Language being learned', { exact: true }).selectOption('fr');
    await expect(
      page.getByText('No grammar fields are available for this language and part of speech.'),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Word', exact: true })).toHaveValue(
      'Draft word',
    );
  });
}
