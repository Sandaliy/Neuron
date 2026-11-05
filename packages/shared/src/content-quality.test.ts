import { describe, expect, it } from 'vitest';

import {
  CONTENT_CHECK_KIND,
  contentChecks,
  contentQualityQuerySchema,
  contentQualitySearchText,
} from './content-quality.js';
import { parseNoteFields } from './note-types.js';

describe('vocabulary content inspection', () => {
  const required = { term: 'Bank', translation: 'river edge' };
  it('keeps every optional omission schema-valid and distinguishes enrichment from a missing source', () => {
    const bare = parseNoteFields('vocab', required);
    expect(contentChecks('vocab', bare)).toEqual(['missing-example', 'missing-definition']);
    const orphan = parseNoteFields('vocab', { ...required, exampleTranslation: 'On the bank.' });
    expect(contentChecks('vocab', orphan)).toEqual([
      'translation-without-example',
      'missing-example',
      'missing-definition',
    ]);
    expect(CONTENT_CHECK_KIND['translation-without-example']).toBe('consistency');
    expect(CONTENT_CHECK_KIND['example-without-translation']).toBe('enrichment');
    expect(CONTENT_CHECK_KIND['missing-example']).toBe('enrichment');
    expect(CONTENT_CHECK_KIND['missing-definition']).toBe('enrichment');
  });
  it('checks presence only and accepts any linguistic content, status and optional grammar', () => {
    expect(contentChecks('vocab', { ...required, example: 'untranslated' })).toEqual([
      'example-without-translation',
      'missing-definition',
    ]);
    expect(
      contentChecks('vocab', {
        ...required,
        example: 'anything',
        exampleTranslation: 'anything',
        definition: 'anything',
      }),
    ).toEqual([]);
    expect(
      contentChecks('vocab', { ...required, example: '\t\u00a0\ufeff\u3000', definition: '' }),
    ).toEqual(['missing-example', 'missing-definition']);
    expect(
      contentChecks('vocab', {
        ...required,
        example: false,
        exampleTranslation: 'present',
        definition: {},
      }),
    ).toEqual(['translation-without-example', 'missing-example', 'missing-definition']);
  });
  it('leaves valid Basic and Cloze Notes outside vocabulary checks', () => {
    expect(contentChecks('basic', parseNoteFields('basic', { front: 'Q', back: 'A' }))).toEqual([]);
    expect(contentChecks('cloze', parseNoteFields('cloze', { text: 'A {{gap}}.' }))).toEqual([]);
    expect(contentChecks('custom', {})).toEqual([]);
  });
  it('searches literal supported content, metadata and locations without judging correctness', () => {
    expect(
      contentQualitySearchText(
        { ...required, example: '100%_literal', note: 'Примечание' },
        ['topic'],
        'Source',
        ['Folder', 'Deck'],
      ),
    ).toContain('100%_literal');
    expect(contentQualitySearchText(required, [], null, ['Folder', 'Deck'])).toContain(
      'folder / deck',
    );
  });
  it('bounds and validates category, search, scope and identity cursors', () => {
    for (const query of [
      { category: 'low-quality' },
      { limit: 201 },
      { limit: 0 },
      { search: ' ' },
      { search: 'x'.repeat(101) },
      { deckId: 'other' },
      { cursor: 'row' },
    ])
      expect(contentQualityQuerySchema.safeParse(query).success).toBe(false);
    expect(contentQualityQuerySchema.parse({ category: 'missing-example' }).limit).toBe(100);
  });
});
