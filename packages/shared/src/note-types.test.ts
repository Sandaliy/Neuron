import { describe, expect, it } from 'vitest';

import {
  NOTE_TYPES,
  NOTE_TYPE_FIELDS,
  NOTE_TYPE_TEMPLATES,
  noteFieldsSchemas,
  parseNoteFields,
  templatesFor,
} from './note-types.js';

describe('vocab notes', () => {
  const complete = {
    term: 'die Sorgfalt',
    translation: 'care, thoroughness',
    grammar: { article: 'die', plural: 'keine' },
  };

  it('accepts a note with only the required fields', () => {
    expect(parseNoteFields('vocab', { term: 'Sorgfalt', translation: 'care' })).toEqual({
      term: 'Sorgfalt',
      translation: 'care',
    });
  });

  it('keeps the optional fields it is given', () => {
    expect(parseNoteFields('vocab', complete)).toEqual(complete);
  });

  it('rejects a note with no translation', () => {
    expect(noteFieldsSchemas.vocab.safeParse({ term: 'Sorgfalt' }).success).toBe(false);
  });

  it('rejects a blank term, which a trimmed empty string would otherwise pass as', () => {
    expect(noteFieldsSchemas.vocab.safeParse({ term: '   ', translation: 'care' }).success).toBe(
      false,
    );
  });

  it('rejects a field nobody defined, so a typo does not vanish into jsonb', () => {
    const result = noteFieldsSchemas.vocab.safeParse({
      term: 'Sorgfalt',
      translation: 'care',
      transaltion: 'care',
    });

    expect(result.success).toBe(false);
  });

  it('trims whitespace off what it stores', () => {
    expect(parseNoteFields('vocab', { term: '  Sorgfalt  ', translation: 'care' })).toEqual({
      term: 'Sorgfalt',
      translation: 'care',
    });
  });
});

describe('basic notes', () => {
  it('needs both sides', () => {
    expect(noteFieldsSchemas.basic.safeParse({ front: 'Fisher equation' }).success).toBe(false);
    expect(parseNoteFields('basic', { front: 'q', back: 'a' })).toEqual({ front: 'q', back: 'a' });
  });
});

describe('cloze notes', () => {
  it('accepts a text with a gap in it', () => {
    const fields = { text: 'Fisher equation: {{i}} = {{r}} + inflation' };

    expect(parseNoteFields('cloze', fields)).toEqual(fields);
  });

  it('rejects a text with no gap, which would produce a card asking nothing', () => {
    expect(noteFieldsSchemas.cloze.safeParse({ text: 'Fisher equation' }).success).toBe(false);
  });

  it('rejects an empty gap', () => {
    expect(noteFieldsSchemas.cloze.safeParse({ text: 'a {{}} b' }).success).toBe(false);
  });
});

describe('field definitions', () => {
  it('lists exactly the fields the schema knows about', () => {
    for (const type of NOTE_TYPES) {
      const inSchema = Object.keys(noteFieldsSchemas[type].shape).sort();
      const listed = NOTE_TYPE_FIELDS[type].map((field) => field.name).sort();

      expect(listed).toEqual(inSchema);
    }
  });

  it('marks a field required exactly when the schema requires it', () => {
    for (const type of NOTE_TYPES) {
      for (const field of NOTE_TYPE_FIELDS[type]) {
        const shape = noteFieldsSchemas[type].shape as Record<
          string,
          { safeParse: (v: unknown) => { success: boolean } }
        >;
        const entry = shape[field.name];

        expect(entry).toBeDefined();
        expect(entry?.safeParse(undefined).success).toBe(!field.required);
      }
    }
  });
});

describe('templatesFor', () => {
  it('leaves out the listening card when the note has no audio', () => {
    const directions = templatesFor('vocab', { term: 'Sorgfalt', translation: 'care' }).map(
      (template) => template.direction,
    );

    expect(directions).toEqual(['recognition', 'recall', 'production']);
  });

  it('includes the listening card once audio is there', () => {
    const directions = templatesFor('vocab', {
      term: 'Sorgfalt',
      translation: 'care',
      audio: 'sorgfalt.mp3',
    }).map((template) => template.direction);

    expect(directions).toContain('listening');
  });

  it('gives a cloze note exactly one card', () => {
    expect(templatesFor('cloze', { text: 'a {{b}} c' })).toHaveLength(1);
  });

  it('only names fields the type actually has', () => {
    for (const type of NOTE_TYPES) {
      const known = new Set(NOTE_TYPE_FIELDS[type].map((field) => field.name));

      for (const template of NOTE_TYPE_TEMPLATES[type]) {
        for (const name of [...template.ask, ...template.answer, ...template.requires]) {
          expect(known).toContain(name);
        }
      }
    }
  });
});
