import { describe, expect, it } from 'vitest';

import {
  NOTE_TYPES,
  NOTE_TYPE_TEMPLATES,
  clozeGaps,
  hasClozeGap,
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

describe('cloze gaps', () => {
  it('numbers bare gaps in the order they appear, one card each', () => {
    expect(clozeGaps('Ich {{stehe}} früh {{auf}}.').map((gap) => gap.number)).toEqual([1, 2]);
  });

  it('keeps the number an author wrote, so two gaps can share a card', () => {
    const gaps = clozeGaps('{{c1::der}} Hund und {{c1::die}} Katze');

    expect(gaps.map((gap) => gap.number)).toEqual([1, 1]);
    expect(gaps.map((gap) => gap.answer)).toEqual(['der', 'die']);
  });

  it('reads the hint an author put after the answer', () => {
    expect(clozeGaps('Er {{c1::ging::past}} weg.')[0]?.hint).toBe('past');
  });

  it('reads every gap after the text has been checked for gaps', () => {
    // One shared global regular expression carries its position between calls,
    // so checking and then reading used to lose the first gap. Three gaps came
    // out as two cards, and only in this order, which is the order the api
    // uses.
    expect(hasClozeGap('a {{b}} c {{d}} e {{f}}')).toBe(true);
    expect(clozeGaps('a {{b}} c {{d}} e {{f}}')).toHaveLength(3);
  });

  it('says where each gap starts and ends, so the text can be rebuilt', () => {
    const text = 'a {{b}} c';
    const gap = clozeGaps(text)[0];

    expect(text.slice(gap?.start, gap?.end)).toBe('{{b}}');
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
      const known = new Set(Object.keys(noteFieldsSchemas[type].shape));

      for (const template of NOTE_TYPE_TEMPLATES[type]) {
        for (const name of [...template.ask, ...template.answer, ...template.requires]) {
          expect(known).toContain(name);
        }
      }
    }
  });
});
