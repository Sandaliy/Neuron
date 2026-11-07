import { describe, expect, it, vi } from 'vitest';

import { problemCardsPageSchema } from '@neuron/shared';
import type { Card, Note } from '@neuron/shared';

import { localProblemCards } from './problem-cards';

vi.mock('./collection-read', () => ({ problemCardCollection: vi.fn() }));
vi.mock('./offline', () => ({
  accountEpoch: () => 1,
  offlineState: () => ({ accountId: 'reader' }),
  retryDownload: vi.fn(),
  useOffline: vi.fn(),
}));
vi.mock('./note-outbox', () => ({ onNoteOutboxChange: vi.fn() }));

const date = '2026-11-03T00:00:00.000Z';
const ids = new Map<string, string>();
/** Readable fixture names, real identities. */
const id = (name: string) => {
  if (!ids.has(name))
    ids.set(name, `00000000-0000-7000-9000-${String(ids.size + 1).padStart(12, '0')}`);
  return ids.get(name)!;
};
const note = (name: string, deck: string, overrides: Partial<Note> = {}): Note => ({
  id: id(name),
  deckId: id(deck),
  noteType: 'vocab',
  fields: { term: `term ${name}`, translation: `meaning ${name}` },
  tags: [],
  source: 'source',
  status: 'active',
  rank: null,
  importBatchId: null,
  createdAt: date,
  updatedAt: date,
  rev: 1,
  ...overrides,
});
let sequence = 0;
const card = (noteName: string, deck: string, overrides: Partial<Card> = {}): Card => ({
  id: `00000000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`,
  noteId: id(noteName),
  deckId: id(deck),
  direction: 'recognition',
  slot: 0,
  state: 'review',
  stability: 3,
  difficulty: 7,
  due: date,
  lastReview: `2026-10-${String(10 + sequence).padStart(2, '0')}T00:00:00.000Z`,
  reps: 12,
  lapses: 3,
  learningStep: 0,
  suspendedAt: null,
  unlockedAt: null,
  updatedAt: date,
  rev: 1,
  ...overrides,
});
const decks = [
  { id: id('folder'), name: 'Languages', parentId: null },
  { id: id('german'), name: 'German', parentId: id('folder') },
  { id: id('orphan'), name: 'Orphan', parentId: id('missing deck') },
];
const names = (page: { items: { note: { id: string } }[] }) =>
  page.items.map((item) => [...ids].find(([, value]) => value === item.note.id)?.[0]);
const filters = {
  deckId: undefined,
  direction: undefined,
  state: 'all' as const,
  sort: 'again' as const,
  search: '',
};

describe('downloaded slipping Cards', () => {
  const notes = [
    note('n1', 'german'),
    note('n2', 'german', { status: 'known' }),
    note('n3', 'german'),
    note('n4', 'orphan'),
    note('n5', 'german'),
  ];
  const cards = [
    card('n1', 'german', { lapses: 5 }),
    card('n1', 'german', { direction: 'recall', lapses: 2 }),
    card('n2', 'german'),
    card('n3', 'german', { suspendedAt: date, direction: 'recall' }),
    card('n4', 'orphan'),
    card('n5', 'german'),
    card('missing', 'german'),
  ];
  const input = { notes, decks, cards, unsent: new Set([id('n5')]) };

  it('lists only the lapse rule from counters, per direction, in live active Notes', () => {
    const page = problemCardsPageSchema.parse(localProblemCards(input, filters));
    expect(page.local).toBe(true);
    expect(names(page)).toEqual(['n1', 'n3']);
    expect(page.items.map((item) => item.card.direction)).toEqual(['recognition', 'recall']);
    expect(page.items[0]).toMatchObject({
      reasons: ['repeated_lapses'],
      deckPath: ['Languages', 'German'],
      evidence: { kind: 'counters', lapses: 5, answers: 12 },
    });
  });

  it('filters by actual schedule state, direction, Folder scope and search', () => {
    expect(names(localProblemCards(input, { ...filters, state: 'suspended' }))).toEqual(['n3']);
    expect(names(localProblemCards(input, { ...filters, state: 'studying' }))).toEqual(['n1']);
    expect(names(localProblemCards(input, { ...filters, direction: 'recall' }))).toEqual(['n3']);
    expect(localProblemCards(input, { ...filters, deckId: id('folder') }).total).toBe(2);
    expect(localProblemCards(input, { ...filters, deckId: id('orphan') }).total).toBe(0);
    expect(localProblemCards(input, { ...filters, search: 'MEANING N3' }).total).toBe(1);
  });

  it('pages a large download by identity without repeating a Card', () => {
    const many = Array.from({ length: 130 }, (_, at) => note(`m${at}`, 'german'));
    const manyCards = many.map((_, at) => card(`m${at}`, 'german', { lapses: 3 + (at % 4) }));
    const large = { notes: many, decks, cards: manyCards, unsent: new Set<string>() };
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = localProblemCards(large, filters, cursor);
      expect(page.total).toBe(130);
      for (const item of page.items) {
        expect(seen.has(item.card.id)).toBe(false);
        seen.add(item.card.id);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen.size).toBe(130);
    expect(pages).toBe(3);
  });
});
