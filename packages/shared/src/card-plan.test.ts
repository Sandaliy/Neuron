import { describe, expect, it } from 'vitest';

import { openingCards, possibleCards, reconcileCards } from './card-plan.js';

import type { LadderStep } from './card-plan.js';

/**
 * The rules a note's cards follow.
 *
 * The reason this file matters more than its size suggests: the editor and the
 * importer both call these functions, so what is proved here is proved for
 * both. The test that the two agree is in apps/api, where the two paths meet a
 * database.
 */

const LADDER: readonly LadderStep[] = [
  { direction: 'recognition', opensAtStability: 0 },
  { direction: 'recall', opensAtStability: 14 },
  { direction: 'production', opensAtStability: 21 },
];

const WORD = { term: 'Sorgfalt', translation: 'care' };

describe('what a note starts with', () => {
  it('gives a new word one card, not three', () => {
    const cards = openingCards('vocab', WORD, LADDER);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.direction).toBe('recognition');
  });

  it('draws the card it is about to make', () => {
    const [card] = openingCards('vocab', WORD, LADDER);

    expect(card?.front).toEqual([{ field: 'term', value: 'Sorgfalt' }]);
    expect(card?.back).toEqual([{ field: 'translation', value: 'care' }]);
  });

  it('gives a cloze note one card per gap, because the gaps are the cards', () => {
    const cards = openingCards('cloze', { text: 'Ich {{stehe}} früh {{auf}}.' }, LADDER);

    expect(cards.map((card) => card.slot)).toEqual([1, 2]);
  });

  it('hides one gap and shows the rest, so the sentence still reads', () => {
    const [first] = openingCards('cloze', { text: 'Ich {{stehe}} früh {{auf}}.' }, LADDER);

    expect(first?.front[0]?.value).toBe('Ich [...] früh auf.');
    expect(first?.back[0]?.value).toBe('Ich stehe früh auf.');
  });

  it('shows the hint the author wrote instead of a bare blank', () => {
    const [card] = openingCards('cloze', { text: 'Er {{c1::ging::past}} weg.' }, LADDER);

    expect(card?.front[0]?.value).toBe('Er [past] weg.');
  });

  it('hides two gaps at once when they share a number', () => {
    const cards = openingCards('cloze', { text: '{{c1::der}} Hund, {{c1::die}} Katze' }, LADDER);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.front[0]?.value).toBe('[...] Hund, [...] Katze');
  });

  it('falls back to what the type can do when the ladder does not mention it', () => {
    // The default ladder talks about recognition and recall, and a cloze note
    // produces neither. Without the fallback the note would arrive with no
    // cards, which looks exactly like the note not arriving.
    const cards = openingCards('cloze', { text: 'a {{b}} c' }, LADDER);

    expect(cards.map((card) => card.direction)).toEqual(['cloze']);
  });

  it('opens a listening card once there is audio to listen to', () => {
    const cards = openingCards('vocab', { ...WORD, audio: 'sorgfalt.mp3' }, [
      { direction: 'listening', opensAtStability: 0 },
    ]);

    expect(cards.map((card) => card.direction)).toEqual(['listening']);
  });

  it('does not open a direction the note cannot produce, whatever the ladder says', () => {
    const cards = openingCards('vocab', WORD, [{ direction: 'listening', opensAtStability: 0 }]);

    expect(cards.map((card) => card.direction)).not.toContain('listening');
  });

  it('opens several at once when the ladder says several start together', () => {
    const cards = openingCards('basic', { front: 'a', back: 'b' }, [
      { direction: 'recognition', opensAtStability: 0 },
      { direction: 'recall', opensAtStability: 0 },
      { direction: 'production', opensAtStability: 14 },
    ]);

    expect(cards.map((card) => card.direction)).toEqual(['recognition', 'recall']);
  });

  it('leaves out a direction the note cannot answer', () => {
    expect(possibleCards('vocab', WORD).map((card) => card.direction)).not.toContain('listening');
  });
});

describe('reconciling an edited note', () => {
  const reviewed = [{ direction: 'recognition', slot: 0, reps: 40 } as const];

  it('keeps the card when the translation changes', () => {
    const result = reconcileCards(
      reviewed,
      'vocab',
      { term: 'Sorgfalt', translation: 'thoroughness' },
      LADDER,
    );

    expect(result.keep).toHaveLength(1);
    expect(result.remove).toHaveLength(0);
    expect(result.create).toHaveLength(0);
    expect(result.reviewsLost).toBe(0);
  });

  it('never opens a direction that was not already there', () => {
    // Opening the next one is the ladder's decision, made from a card's
    // stability. An edit is not evidence about anything.
    const result = reconcileCards(reviewed, 'vocab', WORD, LADDER);

    expect(result.create).toHaveLength(0);
  });

  it('removes the cards a change of type makes impossible, and says what it costs', () => {
    const result = reconcileCards(reviewed, 'cloze', { text: 'a {{b}} c' }, LADDER);

    expect(result.remove).toHaveLength(1);
    expect(result.reviewsLost).toBe(40);
    expect(result.create.map((card) => card.direction)).toEqual(['cloze']);
  });

  it('adds a card for a gap that was added, without touching the others', () => {
    const existing = [{ direction: 'cloze', slot: 1, reps: 12 } as const];
    const result = reconcileCards(existing, 'cloze', { text: '{{a}} and {{b}}' }, LADDER);

    expect(result.keep).toHaveLength(1);
    expect(result.create.map((card) => card.slot)).toEqual([2]);
    expect(result.reviewsLost).toBe(0);
  });

  it('removes the card for a gap that was taken out', () => {
    const existing = [
      { direction: 'cloze', slot: 1, reps: 12 } as const,
      { direction: 'cloze', slot: 2, reps: 3 } as const,
    ];
    const result = reconcileCards(existing, 'cloze', { text: '{{a}} and b' }, LADDER);

    expect(result.remove.map((card) => card.slot)).toEqual([2]);
    expect(result.reviewsLost).toBe(3);
  });

  it('gives a note with nothing left the opening cards again', () => {
    const result = reconcileCards([], 'vocab', WORD, LADDER);

    expect(result.create.map((card) => card.direction)).toEqual(['recognition']);
  });
});
