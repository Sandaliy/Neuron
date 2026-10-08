import { expect, test } from '@playwright/test';

import { useFixtures, usePreferences } from './fixtures';
import { useSpeech } from './speech-fixture';

const stamp = '2026-01-01T00:00:00Z';
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const folder = {
  id: id(1),
  name: 'Languages',
  kind: 'folder',
  parentId: null,
  path: [],
  children: [],
  due: 0,
  fresh: 0,
  position: 0,
  settings: {},
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
};
const de = {
  ...folder,
  id: id(2),
  name: 'German words',
  kind: 'deck',
  parentId: folder.id,
  settings: { targetLanguage: 'de', ladder: [{ direction: 'listening', opensAtStability: 0 }] },
};
const en = {
  ...de,
  id: id(3),
  name: 'English words',
  settings: { ...de.settings, targetLanguage: 'en' },
};
const notes = ['sprechen', 'gehen', 'lesen'].map((term, index) => ({
  id: id(10 + index),
  deckId: de.id,
  noteType: 'vocab',
  fields: {
    term,
    translation: `meaning ${index}`,
    definition: `definition ${index}`,
    example: `example ${index}`,
    exampleTranslation: `translated example ${index}`,
    grammar: { pattern: `pattern ${index}`, auxiliary: 'haben', separable: false },
    mnemonic: `memory ${index}`,
  },
  tags: [],
  status: 'active',
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: stamp,
  updatedAt: stamp,
  rev: 1,
}));
const card = (index: number, direction: string) => ({
  id: id(20 + index),
  noteId: notes[index]!.id,
  deckId: de.id,
  direction,
  slot: 0,
  state: 'new',
  due: stamp,
  stability: null,
  difficulty: null,
  lastReview: null,
  reps: 0,
  lapses: 0,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: stamp,
  updatedAt: stamp,
  rev: 1,
});
const plan = (cards: ReturnType<typeof card>[], targetLanguage = 'de') => ({
  cards,
  notes:
    targetLanguage === 'de'
      ? notes
      : [{ ...notes[0], deckId: en.id, fields: { term: 'speak', translation: 'говорить' } }],
  targetLanguage,
  languages: ['de', 'en'],
  aggregateReady: 3,
  scopeDeckIds: [targetLanguage === 'de' ? de.id : en.id],
  deckSummaries: [
    { deckId: targetLanguage === 'de' ? de.id : en.id, due: 0, fresh: cards.length, nextDue: null },
  ],
  availableCount: cards.length,
  nextDue: null,
  estimatedMinutes: cards.length / 2,
  budgetMinutes: 20,
  reviewCount: 0,
  newCount: cards.length,
  backlog: { active: false, overdueCount: 0, overdueMinutes: 0, budgetMinutes: 20 },
  newCards: {
    mode: 'automatic',
    admitted: cards.length,
    allowed: 3,
    headroomMinutes: 20,
    marginalCost: 1,
    reason: 'withinBudget',
    overrideAvailable: false,
    limitedBy: null,
  },
});

for (const theme of ['light', 'dark'] as const) {
  test(`aggregate Ready stays in setup with hierarchy choices in ${theme}`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme });
    await useFixtures(page, { decks: [{ ...folder, children: [de, en] }], notes });
    await page.route('**/api/study/session', (route) =>
      route.fulfill({ json: { ...plan([card(0, 'recognition')]), aggregateReady: 44 } }),
    );
    await page.goto('/');
    const aggregate = page.getByText('44 ready across 2 languages', { exact: true });
    const estimate = page.getByText('About 1 min', { exact: true });
    await expect(aggregate).not.toBeVisible();
    await expect(estimate).toBeVisible();
    await page.screenshot({
      path: info.outputPath('today-aggregate.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Study setup' }).click();
    await expect(aggregate).toBeVisible();
    await page.getByRole('button', { name: 'German words', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Decks' });
    const parent = picker.getByRole('checkbox', { name: 'Languages', exact: true });
    await expect(parent).toBeChecked();
    await page.keyboard.press('Tab');
    await parent.focus();
    expect(await parent.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
    await page.screenshot({ path: info.outputPath('study-hierarchy.png'), animations: 'disabled' });
    await page.keyboard.press('Space');
    await expect(parent).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(parent).toBeChecked();
    await picker.getByRole('button', { name: 'Use Daily Study decks' }).click();
    await picker.getByRole('button', { name: 'Apply' }).click();
    if (info.project.name !== 'desktop-interaction') {
      await page.setViewportSize({ width: 320, height: 812 });
      await expect(aggregate).toBeVisible();
      expect(await aggregate.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath('today-narrow.png'),
        fullPage: true,
        animations: 'disabled',
      });
    }
  });
}

test('one inherited participating language keeps Ready dominant without redundant language controls', async ({
  page,
}) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useFixtures(page, {
    decks: [
      {
        ...folder,
        settings: { targetLanguage: 'de' },
        children: [
          { ...de, settings: {} },
          { ...de, id: id(4), name: 'More German', settings: {} },
          { ...en, settings: { ...en.settings, dailyStudyIncluded: false } },
        ],
      },
    ],
    notes,
  });
  await page.route('**/api/study/session', (route) =>
    route.fulfill({
      json: {
        ...plan([card(0, 'recognition')]),
        languages: ['de'],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  await expect(page.getByText(/ready across/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Study setup' }).click();
  await expect(page.getByRole('combobox', { name: 'Study language' })).toHaveCount(0);
  await page.getByRole('button', { name: '2 selected', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Decks' });
  await expect(picker.getByText('Languages', { exact: true })).toBeVisible();
  await expect(picker.getByText('English words')).toHaveCount(0);
  await expect(picker.getByRole('checkbox')).toHaveCount(3);
});

test('Apple voice recommendations exclude effects and preserve explicit ordinary choices', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useSpeech(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const voices = [
      'Albert',
      'Bells',
      'Bad News',
      'Boing',
      'Bubbles',
      'Cellos',
      'Organ',
      'Whisper',
      'Zarvox',
      'Samantha',
      'Daniel',
      'Karen',
      'Moira',
    ].map((name) => ({
      name,
      lang: 'en-US',
      voiceURI: name,
      localService: true,
      default: name === 'Albert',
    }));
    window.speechSynthesis.getVoices = () => voices as SpeechSynthesisVoice[];
  });
  await useFixtures(page, { decks: [{ ...folder, children: [en] }], notes });
  await page.route('**/api/study/session', (route) =>
    route.fulfill({
      json: {
        ...plan([{ ...card(0, 'listening'), deckId: en.id }], 'en'),
        languages: ['en'],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Study setup' }).click();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('listening');
  const picker = page.getByRole('combobox', { name: /Voice on this device/ });
  await expect(picker.locator('option')).toHaveCount(3);
  await expect(picker).not.toHaveValue('en-US|Albert|Albert');
  await page.getByRole('button', { name: 'More voices', exact: true }).click();
  await expect(picker.locator('option')).toHaveCount(5);
  await expect(picker.locator('option')).not.toContainText(['Bells', 'Zarvox', 'Whisper']);
  await picker.selectOption('en-US|Albert|Albert');
  await page.getByRole('button', { name: 'Fewer voices' }).click();
  await expect(picker).toHaveValue('en-US|Albert|Albert');
  await page.reload();
  await page.getByRole('button', { name: 'Study setup' }).click();
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('listening');
  await expect(picker).toHaveValue('en-US|Albert|Albert');
  await page.evaluate(() => {
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.name !== 'Albert');
    window.speechSynthesis.getVoices = () => [...voices].reverse();
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  await expect(picker).toHaveValue('en-US|Daniel|Daniel');
  await page.screenshot({
    path: info.outputPath('recommended-apple-voices.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.evaluate(() => {
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.name === 'Bells');
    window.speechSynthesis.getVoices = () => voices;
    window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  await expect(picker).toHaveCount(0);
  await expect(
    page.getByText(/A usable voice for this language is not available yet/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
});

for (const mode of ['listening', 'production', 'mixed'])
  test(`three consecutive ${mode} cards and Undo own fresh interactions`, async ({
    page,
  }, info) => {
    await usePreferences(page, { locale: 'en', theme: 'dark' });
    await useSpeech(page);
    await useFixtures(page, { decks: [{ ...folder, children: [de, en] }], notes });
    const cards = notes.map((_, index) =>
      card(index, mode === 'mixed' ? ['listening', 'production', 'recall'][index]! : mode),
    );
    await page.route('**/api/study/session', (route) => route.fulfill({ json: plan(cards) }));
    await page.route('**/api/reviews', (route) =>
      route.fulfill({
        json: { card: cards.find((item) => item.id === route.request().postDataJSON().cardId) },
      }),
    );
    await page.route('**/api/reviews/undo', (route) => route.fulfill({ json: { card: cards[1] } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Study', exact: true }).click();
    for (let index = 0; index < 3; index++) {
      const reading = page.locator('.neu-learning-reading');
      await expect(reading.locator('.neu-learning-answer')).toHaveCount(0);
      await expect(page.locator('.neu-spelling')).toHaveCount(0);
      if (index > 0)
        await expect(reading.getByText(notes[index - 1]!.fields.term, { exact: true })).toHaveCount(
          0,
        );
      if (cards[index]!.direction === 'listening') {
        await expect(page.getByText('Listen, then type the word', { exact: true })).toHaveCount(1);
        await page.getByRole('button', { name: 'Play audio', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute(
          'data-spoken-text',
          notes[index]!.fields.term,
        );
        await page.evaluate(() => {
          document.documentElement.dataset['speechFail'] = 'true';
        });
        await page.getByRole('button', { name: 'Play audio', exact: true }).click();
      }
      if (cards[index]!.direction !== 'recall') {
        await expect(
          page.getByRole('button', { name: 'Type your answer', exact: true }),
        ).toHaveText('Type your answer');
        await page.getByRole('button', { name: 'Type your answer', exact: true }).click();
        const input = page.getByRole('textbox', { name: 'Type your answer' });
        await expect(input).toHaveValue('');
        await input.fill(`${notes[index]!.fields.term}x`);
        await input.press('Enter');
        await expect(page.getByText('1 extra letter', { exact: true })).toBeVisible();
      } else await page.getByRole('button', { name: 'Show answer', exact: true }).click();
      await expect(reading.getByText(notes[index]!.fields.term, { exact: true })).toBeVisible();
      await expect(reading.getByText(`pattern ${index}`, { exact: true })).toBeVisible();
      await expect(reading.getByText('Pattern', { exact: true })).toBeVisible();
      await expect(reading.getByText('Auxiliary', { exact: true })).toBeVisible();
      await expect(reading.getByText(/grammar\./)).toHaveCount(0);
      if (index === 2) {
        await page.screenshot({
          path: info.outputPath(`${mode}-semantic-answer.png`),
          animations: 'disabled',
        });
        await page.getByRole('button', { name: 'Undo last answer' }).click();
        await expect(reading.getByText(notes[1]!.fields.term, { exact: true })).toBeVisible();
        await expect(reading.getByText(notes[2]!.fields.term, { exact: true })).toHaveCount(0);
        await expect(page.locator('.neu-spelling')).toHaveCount(0);
        await page.getByRole('button', { name: /^Good / }).click();
        await expect(reading.locator('.neu-learning-answer')).toHaveCount(0);
        await expect(page.locator('.neu-spelling')).toHaveCount(0);
        break;
      }
      await page.getByRole('button', { name: /^Good / }).click();
      await expect(
        page.getByText('A usable voice for this language is not available yet.', { exact: true }),
      ).toHaveCount(0);
      await page.evaluate(() => {
        delete document.documentElement.dataset['speechFail'];
      });
    }
  });

test('language setup scopes voices and hierarchy while display choices leave the plan untouched', async ({
  page,
}, info) => {
  await usePreferences(page, { locale: 'en', theme: 'light' });
  await useSpeech(page);
  const sibling = { ...de, id: id(4), name: 'German grammar' };
  await useFixtures(page, { decks: [{ ...folder, children: [de, sibling, en] }], notes });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/study/session', (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const english = body.targetLanguage === 'en';
    return route.fulfill({
      json: plan(
        english
          ? [{ ...card(0, 'listening'), deckId: en.id }]
          : notes.map((_, index) => card(index, 'listening')),
        english ? 'en' : 'de',
      ),
    });
  });
  await page.goto('/');
  await expect(page.getByText('3 ready across 2 languages')).not.toBeVisible();
  const metrics = page.getByText(/^3\s*new$/);
  const aggregate = page.getByText('3 ready across 2 languages');
  await expect(page.getByRole('button', { name: 'Study setup' })).not.toContainText('Daily plan');
  await page.getByRole('button', { name: 'Study setup' }).click();
  await expect(aggregate).toBeVisible();
  expect((await aggregate.boundingBox())!.y).toBeGreaterThan((await metrics.boundingBox())!.y);
  await page.getByRole('combobox', { name: 'Study mode' }).selectOption('listening');
  const voice = page.getByRole('combobox', { name: /Voice on this device/ });
  await expect(voice.locator('option')).toHaveCount(2);
  await expect(voice.locator('option')).not.toContainText(['English']);
  await voice.selectOption('de-DE|Beta|beta');
  await page.getByRole('button', { name: '2 selected', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Decks' });
  await expect(picker.getByRole('checkbox', { name: 'Languages', exact: true })).toBeChecked();
  await expect(picker.getByText('English words')).toHaveCount(0);
  await picker.getByRole('checkbox', { name: /German grammar/ }).uncheck();
  await expect(picker.getByRole('checkbox', { name: 'Languages', exact: true })).toHaveAttribute(
    'aria-checked',
    'mixed',
  );
  await expect(picker.getByText('Temporary selection')).toBeVisible();
  await page.screenshot({
    path: info.outputPath('study-deck-hierarchy.png'),
    animations: 'disabled',
  });
  await picker.getByRole('button', { name: 'Use Daily Study decks' }).click();
  await picker.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('combobox', { name: 'Study language' }).selectOption('en');
  await expect(voice.locator('option')).toHaveCount(1);
  await expect(voice.locator('option')).toHaveText(['English · en-US']);
  await expect(page.locator('[data-numeric]').first()).toHaveText('1');
  await expect(page.getByText(/^0\s*to review$/)).toBeVisible();
  await expect(page.getByText(/^1\s*new$/)).toBeVisible();
  await expect(page.getByText('About 1 min', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Study language' }).selectOption('de');
  await expect(voice).toHaveValue('de-DE|Beta|beta');
  expect(requests.every((body) => !('deckIds' in body))).toBe(true);
  await page.getByRole('button', { name: '2 selected', exact: true }).click();
  await picker.getByRole('checkbox', { name: 'Languages', exact: true }).uncheck();
  await picker.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('heading', { name: 'No decks selected' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Study language' })).toHaveValue('de');
  await page.getByRole('button', { name: 'Choose for this session' }).click();
  await expect(picker.getByRole('checkbox', { name: /German words/ })).not.toBeChecked();
  await picker.getByRole('button', { name: 'Use Daily Study decks' }).click();
  await picker.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeEnabled();
  const count = requests.length;
  await page.getByRole('combobox', { name: 'Meaning source' }).selectOption('definition');
  await page.getByRole('checkbox', { name: 'Example', exact: true }).uncheck();
  expect(requests.length).toBe(count);
  await page.screenshot({
    path: info.outputPath('study-language-setup.png'),
    animations: 'disabled',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(
    page.locator('.neu-learning-reading').getByText('example 0', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator('.neu-learning-reading').getByText('definition 0', { exact: true }),
  ).toBeVisible();
  expect(
    requests
      .filter((body) => 'deckIds' in body)
      .every((body) => Array.isArray(body['deckIds']) && body['deckIds'].length === 0),
  ).toBe(true);
  expect(requests.every((body) => !('display' in body) && !('meaning' in body))).toBe(true);
});
