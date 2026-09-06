import { describe, expect, it } from 'vitest';

import { updateNoteSchema } from './api/notes.js';
import { mergeNoteFields, parseNoteFields } from './note-types.js';

describe('conservative note merge', () => {
  it('keeps populated strings and fills optional fields and grammar leaves', () => {
    const existing = parseNoteFields('vocab', {
      term: 'gehen',
      translation: 'go',
      grammar: { auxiliary: 'sein', separable: false },
    });
    const incoming = parseNoteFields('vocab', {
      term: 'gehen',
      translation: 'overwrite',
      audio: 'audio.ogg',
      grammar: { auxiliary: 'haben', separable: true, reflexive: false, partizip2: 'gegangen' },
    });
    const merged = mergeNoteFields('vocab', existing, incoming);
    expect(merged).toEqual({
      term: 'gehen',
      translation: 'go',
      audio: 'audio.ogg',
      grammar: { auxiliary: 'sein', separable: false, reflexive: false, partizip2: 'gegangen' },
    });
    expect(mergeNoteFields('vocab', merged, incoming)).toEqual(merged);
    expect(existing).not.toHaveProperty('audio');
  });

  it('fills an empty string without replacing a populated sibling', () => {
    expect(
      mergeNoteFields(
        'basic',
        { front: 'question', back: '', note: 'keep' },
        { front: 'other', back: 'answer', note: 'replace' },
      ),
    ).toEqual({ front: 'question', back: 'answer', note: 'keep' });
  });

  it('never replaces a cloze text and its gap identities', () => {
    expect(
      mergeNoteFields(
        'cloze',
        { text: '{{c1::one}} and {{c2::two}}' },
        { text: '{{different}}', note: 'extra' },
      ),
    ).toEqual({ text: '{{c1::one}} and {{c2::two}}', note: 'extra' });
  });

  it('rejects metadata, conversion-only and destructive flags in merge requests', () => {
    const body = { merge: true, noteType: 'basic', fields: { front: 'q', back: 'a' } };
    expect(updateNoteSchema.safeParse(body).success).toBe(true);
    for (const extra of [{ rank: 0 }, { tags: [] }, { status: 'active' }, { discardCards: true }]) {
      expect(updateNoteSchema.safeParse({ ...body, ...extra }).success).toBe(false);
    }
    expect(updateNoteSchema.safeParse({ merge: true }).success).toBe(false);
  });
});
