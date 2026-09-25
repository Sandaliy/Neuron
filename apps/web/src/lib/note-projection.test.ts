import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';

import type { Card, DeckNode, Note } from '@neuron/shared';

import { projectNotes, type StudyPlanProjection } from './note-projection';

const note = (id: string): Note => ({
  id,
  deckId: 'deck',
  noteType: 'vocab',
  fields: { term: id, translation: id },
  tags: [],
  source: null,
  rank: null,
  status: 'active',
  importBatchId: null,
  createdAt: '',
  updatedAt: '',
  rev: 1,
});
const card = (id: string): Card => ({
  id: `card-${id}`,
  noteId: id,
  deckId: 'deck',
  direction: 'production',
  slot: 0,
  state: 'new',
  due: '2026-01-01T00:00:00Z',
  stability: null,
  difficulty: null,
  lastReview: null,
  reps: 0,
  lapses: 0,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: null,
  updatedAt: '',
  rev: 1,
});
function setup() {
  const client = new QueryClient();
  const a = note('a');
  const b = note('b');
  client.setQueryData(['notes', 'a'], { note: a, cards: [card('a')] });
  client.setQueryData(['notes', 'b'], { note: b, cards: [card('b')] });
  client.setQueryData(['notes', 'list', 'status=active'], {
    pages: [{ items: [a] }, { items: [b] }],
    pageParams: [null, 'next'],
  });
  const deck = { id: 'deck', children: [], due: 0, fresh: 2 } as unknown as DeckNode;
  client.setQueryData(['decks'], { decks: [{ id: 'parent', due: 0, fresh: 2, children: [deck] }] });
  return client;
}
it('projects participation through every page and parent immediately and rolls back only its entity', () => {
  const client = setup();
  const rollback = projectNotes(client, ['a'], (value) => ({ ...value, status: 'known' }));
  projectNotes(client, ['b'], (value) => ({ ...value, tags: ['kept'] }));
  expect(client.getQueryData<{ decks: DeckNode[] }>(['decks'])!.decks[0]!.fresh).toBe(1);
  expect(
    client.getQueryData<{ pages: { items: Note[] }[] }>(['notes', 'list', 'status=active'])!
      .pages[0]!.items,
  ).toHaveLength(0);
  rollback();
  expect(client.getQueryData<{ decks: DeckNode[] }>(['decks'])!.decks[0]!.fresh).toBe(2);
  const pages = client.getQueryData<{ pages: { items: Note[] }[] }>([
    'notes',
    'list',
    'status=active',
  ])!;
  expect(pages.pages[0]!.items[0]!.status).toBe('active');
  expect(pages.pages[1]!.items[0]!.tags).toEqual(['kept']);
});
it('does not roll back a newer participation choice or corrupt its counts', () => {
  const client = setup();
  const rollback = projectNotes(client, ['a'], (value) => ({ ...value, status: 'known' }));
  projectNotes(client, ['a'], (value) => ({ ...value, status: 'suspended' }));
  rollback();
  expect(client.getQueryData<{ note: Note }>(['notes', 'a'])!.note.status).toBe('suspended');
  expect(client.getQueryData<{ decks: DeckNode[] }>(['decks'])!.decks[0]!.fresh).toBe(1);
});
it('restores scheduling after a failed reset while keeping an unrelated field edit', () => {
  const client = setup();
  const original = {
    ...card('a'),
    state: 'review' as const,
    stability: 12,
    difficulty: 5,
    reps: 8,
    lastReview: '2026-01-01T00:00:00Z',
  };
  client.setQueryData(['notes', 'a'], { note: note('a'), cards: [original] });
  const rollback = projectNotes(
    client,
    ['a'],
    (value) => value,
    (cards) => cards.map((value) => ({ ...value, state: 'new', reps: 0 })),
  );
  projectNotes(client, ['a'], (value) => ({ ...value, tags: ['keep'] }));
  rollback();
  const result = client.getQueryData<{ note: Note; cards: Card[] }>(['notes', 'a'])!;
  expect(result.cards[0]).toEqual(original);
  expect(result.note.tags).toEqual(['keep']);
});

it('projects Study availability immediately but requires renewed server admission', () => {
  const client = setup();
  const key = ['study-plan', 'all'];
  client.setQueryData(key, {
    notes: [note('a'), note('b')],
    cards: [card('a'), card('b')],
    deckSummaries: [{ deckId: 'deck', due: 0, fresh: 2 }],
    availableCount: 2,
    newCount: 2,
    reviewCount: 0,
  });
  const rollback = projectNotes(client, ['a'], (value) => ({ ...value, status: 'known' }));
  const projected = client.getQueryData<StudyPlanProjection>(key)!;
  expect(projected.localProjection).toBe(true);
  expect(projected.cards.map((value) => value.id)).toEqual(['card-b']);
  expect(projected.availableCount).toBe(1);
  rollback();
  const restored = client.getQueryData<StudyPlanProjection>(key)!;
  expect(restored.cards.map((value) => value.id)).toEqual(['card-a', 'card-b']);
  expect(restored.availableCount).toBe(2);
  expect(restored.localProjection).toBe(true);
});

it('uses complete list summaries before transport and moves note totals without detail requests', () => {
  const client = setup();
  client.removeQueries({ queryKey: ['notes', 'a'], exact: true });
  client.setQueryData(['notes', 'list', ''], {
    pages: [
      {
        items: [
          {
            ...note('a'),
            studyCards: [
              {
                direction: 'production',
                state: 'new',
                due: '2026-01-01T00:00:00Z',
                suspendedAt: null,
              },
            ],
          },
        ],
      },
    ],
    pageParams: [null],
  });
  const undo = projectNotes(client, ['a'], (note) => ({ ...note, status: 'known' }));
  expect(client.getQueryData<{ decks: DeckNode[] }>(['decks'])!.decks[0]!.fresh).toBe(1);
  undo();
  expect(client.getQueryData<{ decks: DeckNode[] }>(['decks'])!.decks[0]!.fresh).toBe(2);
});

it('projects direction-filtered summaries without charging other independent cards', () => {
  const client = setup();
  const recognition = { ...card('a'), id: 'recognition', direction: 'recognition' as const };
  client.setQueryData(['notes', 'a'], { note: note('a'), cards: [card('a'), recognition] });
  const key = ['study-plan', '', 'production'];
  client.setQueryData(key, {
    notes: [note('a')],
    cards: [card('a')],
    deckSummaries: [{ deckId: 'deck', due: 0, fresh: 3 }],
    availableCount: 3,
    estimatedMinutes: 8,
  });
  const rollback = projectNotes(client, ['a'], (n) => ({ ...n, status: 'known' }));
  expect(client.getQueryData<StudyPlanProjection>(key)!.availableCount).toBe(2);
  rollback();
  expect(client.getQueryData<StudyPlanProjection>(key)!.availableCount).toBe(3);
  expect(client.getQueryData<StudyPlanProjection>(key)!.estimatedMinutes).toBe(8);
});
