import { describe, expect, it } from 'vitest';

import { editorFields, filledPaths, readField, writeField } from './note-fields.js';
import { noteFieldsSchemas } from './note-types.js';

import type { EditorSection } from './note-fields.js';

function paths(sections: readonly EditorSection[]): string[] {
  return sections.flatMap((section) => section.fields.map((field) => field.path));
}

function section(sections: readonly EditorSection[], name: string) {
  return sections.find((entry) => entry.name === name);
}

describe('which fields a word gets', () => {
  it('asks a German noun for its article, plural and gender', () => {
    const shown = paths(
      editorFields({ noteType: 'vocab', partOfSpeech: 'noun', targetLanguage: 'de' }),
    );

    expect(shown).toContain('grammar.article');
    expect(shown).toContain('grammar.plural');
    expect(shown).toContain('grammar.gender');
  });

  it('asks a German verb for its principal parts and what it governs', () => {
    const shown = paths(
      editorFields({ noteType: 'vocab', partOfSpeech: 'verb', targetLanguage: 'de' }),
    );

    expect(shown).toEqual(
      expect.arrayContaining([
        'grammar.praeteritum',
        'grammar.partizip2',
        'grammar.auxiliary',
        'grammar.separable',
        'grammar.case',
        'grammar.reflexive',
      ]),
    );
    expect(shown).not.toContain('grammar.article');
  });

  it('asks an English word for its variant, and its reading as IPA', () => {
    const sections = editorFields({
      noteType: 'vocab',
      partOfSpeech: 'noun',
      targetLanguage: 'en',
    });
    const reading = sections[0]?.fields.find((field) => field.path === 'reading');

    expect(paths(sections)).toContain('grammar.variant');
    expect(paths(sections)).toContain('grammar.uncountable');
    expect(reading?.hintKey).toBe('note.hint.readingIpa');
  });

  it('renders no grammar block at all for a word with no grammar', () => {
    const sections = editorFields({
      noteType: 'vocab',
      partOfSpeech: 'adverb',
      targetLanguage: 'de',
    });

    expect(section(sections, 'grammar')).toBeUndefined();
  });

  it('renders no grammar block before the part of speech is chosen', () => {
    expect(section(editorFields({ noteType: 'vocab', targetLanguage: 'de' }), 'grammar')).toBe(
      undefined,
    );
  });

  it('keeps showing a field that is already filled in, whatever the rules say now', () => {
    // A word changed from a noun to a verb still has its plural in the
    // database. A value that disappears from the screen while it is still
    // stored is a value nobody can find or correct.
    const sections = editorFields({
      noteType: 'vocab',
      partOfSpeech: 'verb',
      targetLanguage: 'de',
      filled: new Set(['grammar.plural']),
    });

    expect(paths(sections)).toContain('grammar.plural');
  });

  it('only names paths the schema will accept', () => {
    const shape = noteFieldsSchemas.vocab.shape;

    for (const path of paths(
      editorFields({ noteType: 'vocab', partOfSpeech: 'verb', targetLanguage: 'de' }),
    )) {
      expect(Object.keys(shape)).toContain(path.split('.')[0]);
    }
  });

  it('gives a basic note four fields and a cloze note three', () => {
    expect(paths(editorFields({ noteType: 'basic' }))).toEqual(['front', 'back', 'note', 'image']);
    expect(paths(editorFields({ noteType: 'cloze' }))).toEqual(['text', 'note', 'image']);
  });
});

describe('reading and writing one field', () => {
  it('follows a dotted path', () => {
    expect(readField({ grammar: { article: 'die' } }, 'grammar.article')).toBe('die');
  });

  it('answers undefined rather than throwing when nothing is there', () => {
    expect(readField({ term: 'x' }, 'grammar.article')).toBeUndefined();
  });

  it('drops a field that was cleared rather than storing an empty string', () => {
    expect(writeField({ term: 'x', note: 'y' }, 'note', '')).toEqual({ term: 'x' });
  });

  it('drops the grammar object once its last field is cleared', () => {
    expect(writeField({ term: 'x', grammar: { article: 'die' } }, 'grammar.article', '')).toEqual({
      term: 'x',
    });
  });

  it('leaves the original untouched', () => {
    const fields = { term: 'x' };

    writeField(fields, 'translation', 'y');

    expect(fields).toEqual({ term: 'x' });
  });

  it('lists what is filled in, nested fields included', () => {
    expect(filledPaths({ term: 'x', note: '', grammar: { article: 'die', plural: '' } })).toEqual(
      new Set(['term', 'grammar.article']),
    );
  });
});
