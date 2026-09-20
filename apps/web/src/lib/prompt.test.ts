import { describe, expect, it } from 'vitest';

import { PROMPT_VARIANTS, fillPrompt, parseImport, noteFieldsSchemas } from '@neuron/shared';

import { PROMPTS } from './prompt';

/**
 * The real document, read the way the app reads it.
 *
 * This is the test that matters for the prompt: the parsing is covered in
 * packages/shared, and what could still go wrong is the import path, the
 * markers in the document, or somebody emptying a block. All three fail here
 * and none of them fails anywhere else.
 */
describe('the prompt the app copies', () => {
  it('has all three variants, with something in each', () => {
    expect(PROMPTS.map((prompt) => prompt.variant)).toEqual([...PROMPT_VARIANTS]);

    for (const prompt of PROMPTS) {
      expect(prompt.text.length).toBeGreaterThan(500);
      expect(prompt.text).toContain('Output nothing except the JSON object');
    }
  });

  it('shows an example answer that is valid JSON', () => {
    for (const prompt of PROMPTS) {
      expect(() => JSON.parse(prompt.example)).not.toThrow();
      const parsed = parseImport(prompt.example, 'json');
      for (const row of parsed.rows)
        expect(noteFieldsSchemas[parsed.noteType].safeParse(row.fields).success).toBe(true);
    }
  });
  it('copies one canonical prompt with structured German and English grammar rules', () => {
    for (const targetLanguage of ['de', 'en'] as const) {
      const prompt = fillPrompt(PROMPTS[0]!.text, {
        targetLanguage,
        nativeLanguage: 'en',
        level: 'B1',
        deckName: 'Words',
      });
      for (const field of [
        'grammar.pattern',
        'grammar.pastSimple',
        'grammar.pastParticiple',
        'grammar.countability',
        'grammar.article',
        'grammar.plural',
      ])
        expect(prompt).toContain(field);
      expect(prompt).toContain('Keep the input order');
      expect(prompt).toContain('Do not invent grammar');
    }
  });

  it('asks for the fields the importer actually reads', () => {
    const vocabulary = PROMPTS[0]?.text ?? '';

    for (const field of ['term', 'translation', 'definition', 'example', 'exampleTranslation']) {
      expect(vocabulary).toContain(field);
    }
  });

  it('has nothing left unfilled once a deck is named', () => {
    const filled = fillPrompt(PROMPTS[0]?.text ?? '', {
      targetLanguage: 'de',
      nativeLanguage: 'ru',
      level: 'B1',
      deckName: 'Lektion 4',
    });

    expect(filled).not.toMatch(/\[[A-Z_]+\]/);
  });
});
