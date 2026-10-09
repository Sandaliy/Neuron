import { expect, test } from '@playwright/test';

import { advancePractice, reconcilePractice } from '@neuron/shared';
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

test('Known progress persists across rounds, resume, Undo and eligible membership changes', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  let pool = Array.from({ length: 4 }, (_, index) => ({
    ...notes[0]!,
    id: id(40 + index),
    fields: { term: `Word ${index}`, translation: `Meaning ${index}` },
  }));
  await useFixtures(page, { decks: [deck], notes: pool });
  await page.route('**/api/notes?**', (route) => route.fulfill({ json: { items: pool } }));
  let run: PracticeRun | null = null;
  let version = 0;
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname);
  });
  await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
    if (route.request().method() === 'POST') {
      run = advancePractice(run, route.request().postDataJSON(), pool);
      version++;
    } else if (run) run = reconcilePractice(run, pool);
    return route.fulfill({ json: { run, version } });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  const progress = page.getByRole('progressbar', { name: 'Known Notes', exact: true });
  for (let index = 0; index < 4; index++) {
    await page.getByRole('button', { name: 'Show answer', exact: true }).click();
    await page
      .getByRole('button', { name: index === 0 ? 'Known' : 'Still learning', exact: true })
      .click();
    await expect(progress).toHaveAttribute('aria-valuenow', '25');
  }
  await expect(page.locator('.neu-practice-progress strong')).toHaveText(['3', '1']);
  await page.getByRole('button', { name: 'Repeat still learning', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '25');
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Undo last answer', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '25');
  await waitForPracticeSave(page);
  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '25');
  await expect(page.getByRole('button', { name: 'Undo last answer', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
  // The entry retains classified semantics independently of the active bar.
  await expect(page.getByText('4 / 4 classified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume practice', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '25');
  pool = pool.slice(1);
  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.neu-practice-progress strong')).toHaveText(['3', '0']);
  pool.push({ ...notes[0]!, id: id(60), fields: { term: 'Added', translation: 'New meaning' } });
  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '25');
  await waitForPracticeSave(page);
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.every((path) => path.endsWith('/practice'))).toBe(true);
});

test('an incompatible Typing draft preserves saved fields and progress until replacement confirmation', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  const pool = notes
    .slice(0, 2)
    .map((note) => ({ ...note, fields: { ...note.fields, grammar: { pattern: 'with + noun' } } }));
  await useFixtures(page, { decks: [deck], notes: pool });
  let run: PracticeRun = {
    id: id(70),
    front: 'translation',
    back: ['term', 'grammar.pattern'],
    response: 'reveal',
    statuses: { [pool[0]!.id]: 'known', [pool[1]!.id]: 'learning' },
    queue: [pool[1]!.id],
    round: 2,
  };
  const original = structuredClone(run);
  let version = 3;
  const commands: unknown[] = [];
  await page.route(`**/api/decks/${deck.id}/practice`, (route) => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      run = advancePractice(run, route.request().postDataJSON(), pool);
      version++;
    }
    return route.fulfill({ json: { run, version } });
  });
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Practice setup', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Response mode' })).toHaveValue('reveal');
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
  await expect(page.getByRole('combobox', { name: 'Response mode' })).toHaveValue('typing');
  await expect(page.getByText('0 / 2 notes', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Typing needs one short text answer');
  await expect(page.getByRole('button', { name: 'Start a new run', exact: true })).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('typing-recovery-dark.png'),
    animations: 'disabled',
  });
  await page
    .getByRole('combobox', { name: 'Answer field for Typing', exact: true })
    .selectOption('term');
  await expect(page.getByText('2 / 2 notes', { exact: true })).toBeVisible();
  expect(commands).toEqual([]);
  expect(run).toEqual(original);
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(run).toEqual(original);
  await page.getByRole('button', { name: 'Start a new run', exact: true }).click();
  await page.getByRole('button', { name: 'Replace current run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Type your answer', exact: true })).toBeVisible();
  await waitForPracticeSave(page);
  expect(run.id).not.toBe(original.id);
  expect(run.back).toBe('term');
  expect(run.response).toBe('typing');
  expect(Object.values(run.statuses)).toEqual(['unseen', 'unseen']);
  expect(commands).toHaveLength(1);
});

test('Practice explains identical fields, missing content and Listening restrictions with local recovery', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useSpeech(page);
  await useFixtures(page, { decks: [{ ...deck, settings: {} }], notes });
  const run: PracticeRun | null = null;
  await page.route(`**/api/decks/${deck.id}/practice`, (route) =>
    route.fulfill({ json: { run, version: 0 } }),
  );
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  const question = page
    .getByText('Question field', { exact: true })
    .locator('..')
    .getByRole('button');
  await question.click();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Choose different question and answer fields.');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('listening');
  await question.click();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Translation', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  // Identical fields remain the first blocker; fix the answer before the question.
  await page.getByText('Answer field', { exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('checkbox', { name: 'Word', exact: true }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(
    page.getByText('Listening needs Word as the question field.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use Word', exact: true }).click();
  await expect(
    page.getByText('Set a target language for Listening.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Language being learned', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
  await page.screenshot({
    path: info.outputPath('listening-language-light.png'),
    animations: 'disabled',
  });
  await expect(page.getByRole('option', { name: 'Typing', exact: true })).toBeAttached();
  expect(run).toBeNull();
});

test('Practice keeps response modes visible and explains missing eligible content', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  const pool = [
    { ...notes[0]!, fields: { front: 'Only a question' } },
    { ...notes[1]!, fields: { back: 'Only an answer' } },
  ];
  await useFixtures(page, { decks: [deck], notes: pool });
  await page.route(`**/api/decks/${deck.id}/practice`, (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'No Notes contain both selected fields. Choose different fields.',
  );
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
  await expect(page.getByRole('status')).toHaveText(
    'No Notes contain both selected fields. Choose different fields.',
  );
  const listening = page.getByRole('option', { name: 'Listening', exact: true });
  await expect(listening).toBeEnabled();
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('listening');
  await expect(
    page.getByText('Add a Word field to use Listening, or choose Self-check.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use Self-check', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Response mode' })).toHaveValue('reveal');
});

test('unavailable Listening preserves valid fields when returning to Self-check', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'dark' });
  await useFixtures(page, {
    decks: [deck],
    notes: [{ ...notes[0]!, noteType: 'basic', fields: { front: 'Question', back: 'Answer' } }],
  });
  await page.route(`**/api/decks/${deck.id}/practice`, (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Response mode' }).selectOption('listening');
  await expect(
    page.getByText('Add a Word field to use Listening, or choose Self-check.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Front', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use Self-check', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Response mode' })).toHaveValue('reveal');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
  await expect(page.getByText('1 / 1 notes', { exact: true })).toBeVisible();
});

for (const pending of [false, true])
  test(`Practice explains ${pending ? 'pending' : 'unavailable'} voice fallback and retains a usable Listening configuration`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme: 'light' });
    await useSpeech(page);
    await page.addInitScript((pending) => {
      window.speechSynthesis.getVoices = () =>
        (pending
          ? []
          : [
              { name: 'English', lang: 'en-US', voiceURI: 'en', localService: true, default: true },
            ]) as SpeechSynthesisVoice[];
    }, pending);
    await useFixtures(page, { decks: [deck], notes });
    await page.route(`**/api/decks/${deck.id}/practice`, (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.goto(`/notes?deckId=${deck.id}`);
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await page.getByRole('combobox', { name: 'Response mode' }).selectOption('listening');
    await expect(page.getByText(/A usable voice for this language/)).toBeVisible();
    await expect(page.getByText(/Use Show answer if audio is unavailable/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(`listening-${pending ? 'pending' : 'fallback'}-light.png`),
      animations: 'disabled',
    });
  });

for (const answer of ['multiline', 'long', 'boolean'] as const)
  test(`Practice explains an ineligible ${answer} answer without suggesting Study skills`, async ({
    page,
  }) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    const fields =
      answer === 'boolean'
        ? { term: 'aufstehen', grammar: { separable: true } }
        : { front: 'Question', back: answer === 'long' ? 'a'.repeat(201) : 'first\nsecond' };
    await useFixtures(page, { decks: [deck], notes: [{ ...notes[0]!, fields }] });
    await page.route(`**/api/decks/${deck.id}/practice`, (route) =>
      route.fulfill({ json: { run: null, version: 0 } }),
    );
    await page.goto(`/notes?deckId=${deck.id}`);
    await page.getByRole('button', { name: 'Start practice', exact: true }).click();
    await page.getByRole('combobox', { name: 'Response mode' }).selectOption('typing');
    await expect(page.getByRole('status')).toContainText('Typing needs one short text answer');
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('combobox', { name: 'Answer field for Typing', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Use Self-check', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
    await expect(page.getByText(/Enable.*Typing/)).toHaveCount(0);
  });

test('empty Practice setup explains how to add eligible content', async ({ page }) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useFixtures(page, { decks: [deck], notes: [] });
  await page.route(`**/api/decks/${deck.id}/practice`, (route) =>
    route.fulfill({ json: { run: null, version: 0 } }),
  );
  await page.goto(`/notes?deckId=${deck.id}`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Add Notes to this Deck to start Practice.');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeDisabled();
});

test('Practice Undo traverses this visit through completion, rewinds Known progress, and ends at exit', async ({
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
  const progress = page.getByRole('progressbar', { name: 'Known Notes', exact: true });
  const undo = page.getByRole('button', { name: 'Undo last answer', exact: true });
  await expect(counts).toHaveText(['0', '0']);
  await expect(undo).toBeDisabled();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Still learning', exact: true }).click();
  await expect(counts).toHaveText(['1', '0']);
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(counts).toHaveText(['1', '1']);
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Repeat still learning', exact: true }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(counts).toHaveText(['0', '2']);
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await undo.click();
  await expect(counts).toHaveText(['1', '1']);
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await expect(page.getByText('Sorgfalt', { exact: true })).toBeVisible();
  await undo.click();
  await expect(counts).toHaveText(['1', '0']);
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
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
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  await expect(undo).toBeDisabled();
});

test('Practice keeps setup accessible, resumes exactly, and confirms a changed run', async ({
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
  await expect(page.locator('[data-learning-screen]')).toBeVisible();
  await expect(page.getByText('Baum', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exit Practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Practice setup', exact: true })).toBeVisible();
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
    'This replaces your current Practice progress',
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
    'This replaces your current Practice progress',
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
