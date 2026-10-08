import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { possibleCards } from '@neuron/shared';
import type { Note, NoteFields } from '@neuron/shared';

import { renderWithProviders } from '../../testing/render';

import { DEFAULT_CARD_DISPLAY, displayedFace, RevealedStudyContent } from './card-display';

const note: Note = {
  id: 'note',
  deckId: 'deck',
  noteType: 'vocab',
  fields: {
    term: 'sprechen',
    translation: 'speak',
    definition: 'communicate with words',
    example: 'Wir sprechen.',
    exampleTranslation: 'We speak.',
    grammar: { pattern: 'mit jemandem sprechen', gender: 'm', separable: false },
    mnemonic: 'A memory hook',
  },
  tags: [],
  status: 'active',
  source: null,
  rank: null,
  importBatchId: null,
  createdAt: '',
  updatedAt: '',
  rev: 1,
};
describe('Study display remains separate from independently scheduled skills', () => {
  it.each(['recognition', 'recall', 'production', 'listening'] as const)(
    'uses the preferred meaning for %s without changing its identity or answer target',
    (direction) => {
      const face = possibleCards(note.noteType, note.fields as NoteFields).find(
        (item) => item.direction === direction,
      )!;
      const before = JSON.stringify(face);
      const shown = displayedFace(note, face, { meaning: 'definition', support: [] });
      expect(shown.direction).toBe(face.direction);
      expect(shown.slot).toBe(face.slot);
      if (direction === 'recognition')
        expect(shown.back).toEqual([{ field: 'definition', value: note.fields['definition'] }]);
      else expect(shown.back).toEqual(face.back);
      expect(JSON.stringify(face)).toBe(before);
    },
  );
  it('labels populated supporting fields and grammar without leaking raw paths or duplicate main answers', () => {
    const face = possibleCards(note.noteType, note.fields as NoteFields).find(
      (item) => item.direction === 'listening',
    )!;
    renderWithProviders(
      <RevealedStudyContent
        note={note}
        face={face}
        display={DEFAULT_CARD_DISPLAY}
        language="de"
        identity="card"
      />,
    );
    expect(screen.getAllByText('sprechen', { exact: true })).toHaveLength(1);
    for (const label of ['Pattern', 'Grammar', 'Gender', 'Separable'])
      expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Masculine')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.queryByText(/grammar\./)).not.toBeInTheDocument();
  });
  it('hides only optional content and falls back when the preferred meaning is absent', () => {
    const sparse = { ...note, fields: { term: 'sprechen', translation: 'speak' } };
    const face = possibleCards(sparse.noteType, sparse.fields as NoteFields)[0]!;
    expect(displayedFace(sparse, face, { meaning: 'definition', support: [] })).toBe(face);
    renderWithProviders(
      <RevealedStudyContent
        note={note}
        face={face}
        display={{ meaning: 'translation', support: [] }}
        language="de"
        identity="card"
      />,
    );
    expect(screen.getByText('speak')).toBeInTheDocument();
    expect(screen.queryByText('Wir sprechen.')).not.toBeInTheDocument();
    expect(screen.queryByText('Pattern')).not.toBeInTheDocument();
  });
});
