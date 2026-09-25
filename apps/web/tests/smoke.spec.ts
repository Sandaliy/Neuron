import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';

test('Today opens a ready study session through its controls', async ({ page }) => {
  await usePreferences(page, { theme: 'light', locale: 'en' });
  const at = '2026-01-01T00:00:00.000Z';
  await useFixtures(page, {
    decks: [
      {
        id: '01900000-0000-7000-8000-000000000901',
        kind: 'deck',
        name: 'Words',
        parentId: null,
        path: [],
        position: 0,
        children: [],
        settings: null,
        due: 0,
        fresh: 1,
        createdAt: at,
        updatedAt: at,
        rev: 1,
      },
    ],
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await expect(page.getByText('care, thoroughness', { exact: true })).toBeVisible();
});

test('Library navigation reaches a deck and its notes', async ({ page }) => {
  await usePreferences(page, { theme: 'light', locale: 'en' });
  await useFixtures(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.getByRole('button', { name: /^Deutsch(?:\s|$)/ }).click();
  await page.getByRole('button', { name: /^Grammatik(?:\s|$)/ }).click();
  await page.getByRole('button', { name: /^Verben mit Dativ/ }).click();
  await expect(page).toHaveURL(/\/notes\?deckId=d3/);
});

test('Settings opens a reachable account action', async ({ page }) => {
  await usePreferences(page, { theme: 'light', locale: 'en' });
  await useFixtures(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Change your password' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
