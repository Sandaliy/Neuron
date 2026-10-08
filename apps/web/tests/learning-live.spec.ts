import { expect, test } from '@playwright/test';

import { usePreferences } from './fixtures';
import { useSpeech } from './speech-fixture';

// Opt-in: uses only the guarded throwaway DATABASE_URL_TEST database. Transport,
// validation, RLS, admission and persistence are real; sign-in and speech are fixtures.
test('real Deck activation, Study ratings and schedule-free Practice', async ({ page }, info) => {
  test.skip(process.env['LEARNING_DATABASE_E2E'] !== 'true', 'Requires the throwaway database');
  test.setTimeout(180_000);
  await useSpeech(page);
  const { serve } = await import('../../api/node_modules/@hono/node-server/dist/index.mjs');
  const { testDatabase, createUser, repositoriesFor } =
    await import('../../api/src/db/testing/database.js');
  const { testServer } = await import('../../api/src/testing/server.js');
  const database = testDatabase();
  if (!database) throw new Error('Throwaway database required');
  const userId = `learning-browser-${Date.now()}`;
  await createUser(database, userId);
  const repo = repositoriesFor(database, userId);
  const app = testServer(database, userId);
  const deck = await repo.decks.create({
    name: 'German essentials',
    kind: 'deck',
    settings: { targetLanguage: 'de', nativeLanguage: 'en' },
  });
  const seeded = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckId: deck.id,
      noteType: 'vocab',
      fields: { term: 'Sorgfalt', translation: 'care', acceptedAnswers: ['Genauigkeit'] },
    }),
  });
  expect(seeded.status).toBe(201);
  const { note } = await seeded.json();
  const original = await repo.cards.forNote(note.id);
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  const address = server.address() as { port: number };
  try {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: `http://127.0.0.1:${address.port}${url.pathname}${url.search}`,
        });
        await route.fulfill({ response });
      },
    );
    await page.goto(`/notes?deckId=${deck.id}`);
    await page.getByRole('button', { name: 'Study skills', exact: true }).click();
    await page.getByRole('switch', { name: 'Typing', exact: true }).click();
    await page.getByRole('switch', { name: 'Listening', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const enabled = await repo.cards.forNote(note.id);
    expect(enabled).toHaveLength(3);
    expect(enabled.find((card) => card.id === original[0]!.id)).toEqual(original[0]);
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Study setup', exact: true }).click();
    await page.getByRole('combobox', { name: 'Study mode' }).selectOption('listening');
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await expect(page.getByText('Sorgfalt', { exact: true })).toHaveCount(0);
    // The system voice fixture keeps this database check independent of host audio.
    const replay = page.getByRole('button', { name: 'Play / replay', exact: true });
    if (await replay.isEnabled()) {
      await replay.click();
      await replay.click();
    } else
      await expect(
        page.getByText('A usable voice for this language is not available yet.'),
      ).toBeVisible();
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('button', { name: 'Study setup', exact: true }).click();
    await page.getByRole('combobox', { name: 'Study mode' }).selectOption('production');
    await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
    await page.getByLabel('Type your answer', { exact: true }).fill('Sorgfaltx');
    await page.getByLabel('Type your answer', { exact: true }).press('Enter');
    await expect(page.getByText('1 extra letter', { exact: true })).toBeVisible();
    expect(await repo.reviews.countForCards(enabled.map((card) => card.id))).toBe(0);
    await page.screenshot({ path: info.outputPath('live-typing.png'), animations: 'disabled' });
    await page.getByRole('button', { name: /^Easy / }).click();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    expect(await repo.reviews.countForCards(enabled.map((card) => card.id))).toBe(1);
    const beforePractice = await repo.cards.forNote(note.id);
    for (const response of ['typing', 'listening']) {
      await page.goto(`/notes?deckId=${deck.id}`);
      await page.getByRole('button', { name: 'Practice setup', exact: true }).first().click();
      await page.getByRole('combobox', { name: 'Response mode' }).selectOption(response);
      if (response === 'listening') {
        await expect(page.getByText('0 / 1 notes')).toBeVisible();
        await page
          .getByText('Question field', { exact: true })
          .locator('..')
          .getByRole('button')
          .click();
        await page.getByRole('checkbox', { name: 'Translation', exact: true }).uncheck();
        await page.getByRole('checkbox', { name: 'Word', exact: true }).check();
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await page
          .getByText('Answer field', { exact: true })
          .locator('..')
          .getByRole('button')
          .click();
        await page.getByRole('checkbox', { name: 'Word', exact: true }).uncheck();
        await page.getByRole('checkbox', { name: 'Translation', exact: true }).check();
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(page.getByText('1 / 1 notes')).toBeVisible();
      }
      const apply = page.getByRole('button', {
        name: response === 'typing' ? 'Start practice' : 'Start a new run',
        exact: true,
      });
      await expect(apply).toBeEnabled({ timeout: 10_000 });
      await apply.click();
      if (response === 'listening')
        await page.getByRole('button', { name: 'Replace current run', exact: true }).click();
      await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
      await page.getByLabel('Type your answer', { exact: true }).fill('Genauigkeit');
      await page.getByLabel('Type your answer', { exact: true }).press('Enter');
      await expect(page.getByText('Correct', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Known', exact: true }).click();
      await expect
        .poll(async () => (await repo.practice.get(deck.id)).run!.statuses[note.id])
        .toBe('known');
      await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
      await expect
        .poll(async () => (await repo.practice.get(deck.id)).run!.statuses[note.id])
        .toBe('unseen');
      expect((await repo.practice.get(deck.id)).run!.statuses[note.id]).toBe('unseen');
      expect(await repo.cards.forNote(note.id)).toEqual(beforePractice);
      expect(await repo.reviews.countForCards(enabled.map((card) => card.id))).toBe(1);
    }
  } finally {
    server.close();
  }
});
