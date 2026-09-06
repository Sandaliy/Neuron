import { describe, expect, it } from 'vitest';

import { PROMPT_VARIANTS, fillPrompt, missingFromPrompt, readPrompts } from './prompt.js';

/**
 * Reading a prompt document, against a small one written here.
 *
 * The real document is read in apps/web, where it is actually imported, so that
 * test proves the wiring as well as the parsing. This one proves the parsing on
 * its own, including the parts a real document happens not to have.
 */
const DOCUMENT = [
  '# The prompt',
  '',
  'Some prose that is not a prompt.',
  '',
  '<!-- prompt:vocabulary -->',
  '',
  '```text',
  'Target language: [TARGET_LANGUAGE]',
  'Deck topic: [DECK_NAME]',
  '```',
  '',
  '<!-- example:vocabulary -->',
  '',
  '```json',
  '{ "notes": [] }',
  '```',
  '',
  '<!-- prompt:theory -->',
  '',
  '```text',
  'One fact per card, in [NATIVE_LANGUAGE].',
  '```',
  '',
  '<!-- prompt:cloze -->',
  '',
  '```text',
  'Mark gaps for [DECK_NAME].',
  '```',
].join('\n');

describe('reading a prompt document', () => {
  const prompts = readPrompts(DOCUMENT);

  it('finds every variant, in the order they are offered', () => {
    expect(prompts.map((prompt) => prompt.variant)).toEqual([...PROMPT_VARIANTS]);
  });

  it('takes the block after the marker and not the prose before it', () => {
    expect(prompts[0]?.text).toBe('Target language: [TARGET_LANGUAGE]\nDeck topic: [DECK_NAME]');
  });

  it('reads the example separately from the prompt', () => {
    expect(prompts[0]?.example).toBe('{ "notes": [] }');
  });

  it('answers with an empty string for a variant the document does not have', () => {
    expect(readPrompts('# nothing here')[0]?.text).toBe('');
  });
});

describe('filling a prompt in', () => {
  it('substitutes the languages by name, the level and the deck', () => {
    const filled = fillPrompt(readPrompts(DOCUMENT)[0]?.text ?? '', {
      targetLanguage: 'de',
      nativeLanguage: 'ru',
      level: 'B1',
      deckName: 'Menschen B1, Lektion 4',
    });

    expect(filled).toContain('Target language: German');
    expect(filled).toContain('Deck topic: Menschen B1, Lektion 4');
    expect(missingFromPrompt(filled)).toEqual([]);
  });

  it('leaves a placeholder it has nothing for visible', () => {
    // A prompt saying [TARGET_LANGUAGE] reads as unfinished, which it is. One
    // saying "undefined" reads as finished and produces wrong cards.
    const filled = fillPrompt(readPrompts(DOCUMENT)[0]?.text ?? '', { deckName: 'Untitled' });

    expect(filled).toContain('[TARGET_LANGUAGE]');
    expect(missingFromPrompt(filled)).toEqual(['TARGET_LANGUAGE']);
  });
});
