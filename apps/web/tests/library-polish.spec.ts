import { expect, test } from '@playwright/test';

import { manyNotes, useFixtures, usePreferences } from './fixtures';

const leaf = {
  id: 'leaf',
  name: 'Words for everyday conversations',
  kind: 'deck',
  parentId: 'folder',
  path: ['folder'],
  children: [],
  due: 2,
  fresh: 3,
  noteCount: 8,
  settings: { targetLanguage: 'de' },
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
const other = {
  ...leaf,
  id: 'other',
  name: 'English',
  parentId: null,
  path: [],
  settings: { targetLanguage: 'en' },
};
const states = [
  { new: 3, learning: 0, review: 0, relearning: 0 },
  { new: 1, learning: 0, review: 2, relearning: 0 },
  { new: 0, learning: 1, review: 2, relearning: 0 },
  { new: 0, learning: 0, review: 2, relearning: 1 },
  { new: 0, learning: 0, review: 3, relearning: 0 },
  { new: 0, learning: 0, review: 0, relearning: 0 },
];
const labels = [
  'New',
  'Partly started',
  'Learning',
  'Learning',
  'Practiced',
  'No cards',
  'Known',
  'Set aside',
];
const notes = manyNotes(8).map((note, index) => ({
  ...note,
  deckId: leaf.id,
  fields: { term: `Example ${index + 1}`, translation: 'Separate learning directions' },
  cardStates: states[index] ?? states[4],
  status: index === 6 ? 'known' : index === 7 ? 'suspended' : 'active',
}));

for (const theme of ['light', 'dark'] as const) {
  test(`hierarchy, destinations and truthful progress in ${theme}`, async ({ page }, info) => {
    await usePreferences(page, { theme, locale: 'en' });
    await useFixtures(page, { decks: [folder, other], notes });
    await page.route('**/api/decks/leaf/practice', (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.goto('/library');
    await expect(page.getByText('Decks: 1 · 8 notes')).toBeVisible();
    await page.getByRole('button', { name: 'Show what is inside', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /^Words for everyday conversations/ }),
    ).toContainText('8 notes · Cards: 2 due · 3 new');
    await page.screenshot({
      path: info.outputPath('hierarchy.png'),
      animations: 'disabled',
      fullPage: true,
    });
    await page.getByRole('button', { name: /^Words for everyday conversations/ }).click();
    for (const [index, label] of labels.entries()) {
      const row = page.getByRole('button', { name: new RegExp(`^Example ${index + 1} `) });
      await expect(row.getByText(label, { exact: true })).toBeVisible();
      expect((await row.boundingBox())?.height).toBe(52);
    }
    await expect(page.locator('[aria-label="New cards: 1, Practiced cards: 2"]')).toBeVisible();
    await expect(page.locator('[aria-label="Practiced cards: 3"]')).toBeVisible();
    await expect(page.getByText(/Mixed|In review|due now/)).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('progress.png'),
      animations: 'disabled',
      fullPage: true,
    });

    await page.goto('/import?deckId=leaf');
    await page.getByText('Change destination', { exact: true }).click();
    await page.getByRole('button', { name: 'Import into', exact: true }).click();
    const picker = page.getByRole('dialog');
    const chosen = picker.getByRole('button', { name: /^Words for everyday conversations/ });
    await expect(chosen).toHaveAttribute('aria-pressed', 'true');
    await expect(chosen).toContainText('German');
    await page.keyboard.press('Tab');
    await chosen.focus();
    await expect(chosen).toBeFocused();
    expect(await chosen.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
    await page.screenshot({ path: info.outputPath('destination.png'), animations: 'disabled' });
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('English');
    await expect(picker.getByRole('button', { name: /^German/ })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'English', exact: true })).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('missing');
    await expect(picker.getByRole('status')).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('German');
    await expect(chosen).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search', exact: true }).fill('');
    await picker.getByRole('button', { name: 'German', exact: true }).click();
    await expect(chosen).toHaveCount(0);
    await expect(picker.getByRole('button', { name: 'German', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await picker.getByRole('button', { name: 'German', exact: true }).click();
    await chosen.focus();
    await page.keyboard.press('Enter');
    await expect(picker).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('missing progress counts do not claim there are no Cards', async ({ page }) => {
  const note = { ...notes[0], cardStates: undefined };
  await usePreferences(page, { theme: 'light', locale: 'en' });
  await useFixtures(page, { decks: [folder], notes: [note] });
  await page.goto('/notes?deckId=leaf');
  await expect(
    page.getByRole('button', { name: /^Example 1/ }).getByText('Studying'),
  ).toBeVisible();
  await expect(page.getByText('No cards', { exact: true })).toHaveCount(0);
});
