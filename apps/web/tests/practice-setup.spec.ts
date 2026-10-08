import { expect, test } from '@playwright/test';

import { advancePractice } from '@neuron/shared';
import type { PracticeRun } from '@neuron/shared';

import { useFixtures, usePreferences, waitForPracticeSave } from './fixtures';
import { useSpeech } from './speech-fixture';

const stamp = '2026-01-01T00:00:00Z';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const deck = {
  id: id(1),
  name: 'Words',
  kind: 'deck',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 0,
  position: 0,
  settings: { targetLanguage: 'de' },
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
};
const notes = [
  { id: id(2), fields: { term: 'Sorgfalt', translation: 'care' } },
  { id: id(3), fields: { term: 'Baum', translation: 'tree' } },
  { id: id(4), fields: { term: 'Buch' } },
].map((item) => ({
  ...item,
  deckId: deck.id,
  noteType: 'vocab',
  tags: [],
  status: 'active',
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
}));

test('Practice Undo traverses this visit through completion, rewinds classified progress, and ends at exit', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes });
  let run: PracticeRun | null = null;
  let version = 0;
  await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
    if (route.request().method() === 'POST') {
      run = advancePractice(run, route.request().postDataJSON(), notes);
      version++;
    }
    return route.fulfill({ json: { run, version } });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  const counts = page.locator('.neu-practice-progress strong');
  const progress = page.getByRole('progressbar', { name: 'Practice', exact: true });
  const undo = page.getByRole('button', { name: 'Undo last answer', exact: true });
  await expect(counts).toHaveText(['0', '0']);
  await expect(undo).toBeDisabled();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Still learning', exact: true }).click();
  await expect(counts).toHaveText(['1', '0']);
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(counts).toHaveText(['1', '1']);
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('button', { name: 'Repeat still learning', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(counts).toHaveText(['0', '2']);
  await undo.click();
  await expect(counts).toHaveText(['1', '1']);
  await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
  await undo.click();
  await expect(counts).toHaveText(['1', '0']);
  await expect(page.getByText('Baum', { exact: true })).toBeVisible();
  await undo.click();
  await expect(counts).toHaveText(['0', '0']);
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(undo).toBeDisabled();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect.poll(() => run?.statuses[notes[0]!.id]).toBe('known');
  await waitForPracticeSave(page);
  await page.getByRole('button', { name: 'Exit Practice' }).click();
  await page.getByRole('button', { name: 'Resume practice', exact: true }).click();
  await expect(counts).toHaveText(['0', '1']);
  await expect(undo).toBeDisabled();
});

test('Practice exposes its recipe on every entry, resumes exactly, and confirms a changed run', async ({
  page,
}, info) => {
  await useSpeech(page);
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, { decks: [deck], notes });
  let run: PracticeRun | null = null;
  let version = 0;
  let releaseAnswer!: () => void;
  const heldAnswer = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  let holdNextAnswer = true;
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await page.route(`**/api/decks/${deck.id}/practice`, async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      if (command.kind === 'answer' && holdNextAnswer) {
        holdNextAnswer = false;
        await heldAnswer;
      }
      run = advancePractice(run, command, notes);
      version++;
    }
    await route.fulfill({ json: { run, version } });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.locator('[data-learning-screen]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Neuron' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Response mode' })).toHaveValue('reveal');
  await expect(page.getByRole('button', { name: 'Word', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Translation', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Self-check' })).toBeAttached();
  await expect(page.getByRole('option', { name: 'Typing' })).toBeAttached();
  await expect(page.getByRole('option', { name: 'Listening' })).toBeAttached();
  await expect(page.getByText('2 / 3 notes')).toBeVisible();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  const counts = page.locator('[aria-label="Practice progress"] strong');
  await expect(counts.nth(0)).toHaveText('0');
  await expect(counts.nth(1)).toHaveText('0');
  await expect(page.getByRole('group', { name: 'Still learning 0', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Known 0', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('practice-progress.png'), animations: 'disabled' });
  await expect.poll(() => run?.id).toBeTruthy();
  const firstRun = run?.id;
  await expect(page.getByRole('button', { name: 'Practice setup', exact: true })).toHaveCount(0);
  expect(run?.id).toBe(firstRun);
  await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(counts.nth(0)).toHaveText('0');
  await expect(counts.nth(1)).toHaveText('1');
  releaseAnswer();
  await expect.poll(() => run?.statuses[notes[0]!.id]).toBe('known');
  await waitForPracticeSave(page);
  const resumedRun = structuredClone(run);
  await page.reload();
  await expect(page.getByText('Self-check · Word → Translation', { exact: true })).toBeVisible();
  await expect(page.getByText('1 / 2 classified', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('practice-entry.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Resume practice/ }).click();
  await expect(page.getByText('Baum', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('practice-resume.png'), animations: 'disabled' });
  await expect(counts.nth(0)).toHaveText('0');
  await expect(counts.nth(1)).toHaveText('1');
  expect(run?.id).toBe(firstRun);
  expect(run).toEqual(resumedRun);

  await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
  await page.getByRole('button', { name: 'Practice setup', exact: true }).click();
  await page.getByText('Question field', { exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByText('Answer field', { exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new run' })).toContainText(
    'current Practice progress will be replaced',
  );
  await page
    .getByRole('dialog', { name: 'Start a new run' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(run?.id).toBe(firstRun);
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await page.getByRole('button', { name: 'Replace current run', exact: true }).click();
  await expect.poll(() => run?.id).not.toBe(firstRun);
  expect(run?.front).toBe('translation');
  expect(run?.back).toBe('term');
  const fieldRun = run?.id;
  await expect(counts.nth(0)).toHaveText('0');
  await expect(counts.nth(1)).toHaveText('0');
  await expect.poll(() => run?.id).toBe(fieldRun);
  await waitForPracticeSave(page);
  await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
  await page.getByRole('button', { name: 'Practice setup', exact: true }).click();
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
  await expect(page.getByText('2 / 3 notes')).toBeVisible();
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new run' })).toContainText(
    'current Practice progress will be replaced',
  );
  await page
    .getByRole('dialog', { name: 'Start a new run' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(run?.id).toBe(fieldRun);
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await page.getByRole('button', { name: 'Replace current run', exact: true }).click();
  await expect(counts.nth(0)).toHaveText('0');
  await expect(counts.nth(1)).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Type your answer', exact: true })).toBeVisible();
  await expect.poll(() => run?.id).not.toBe(fieldRun);
  await expect.poll(() => run?.response).toBe('typing');
  await waitForPracticeSave(page);
  await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
  await page.getByRole('button', { name: 'Practice setup', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Response mode' })).toHaveValue('typing');
  await expect(page.getByRole('option', { name: 'Listening' })).toBeAttached();
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('listening');
  await expect(page.getByText('0 / 3 notes')).toBeVisible();
  await page.getByText('Question field', { exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByText('Answer field', { exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('2 / 3 notes')).toBeVisible();
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await page.getByRole('button', { name: 'Replace current run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
  expect(writes.every((path) => path.endsWith('/practice'))).toBe(true);
});
