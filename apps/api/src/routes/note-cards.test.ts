import { beforeAll, describe, expect, it } from 'vitest';

import { RATING } from '@neuron/core';
import { NOTE_TYPES } from '@neuron/shared';
import type { Card, Deck, Note, NoteTypeName } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * The one implementation of card generation, seen from both ends.
 *
 * The rules are in `@neuron/shared`, and its own tests cover what they say.
 * What is proved here is that the two ways a note can be made, typing one and
 * importing one, come out the same, and that editing a note does not throw
 * away a schedule.
 *
 * Two implementations would diverge quietly and the difference would show up
 * months later as cards behaving differently depending on how they were added,
 * with no way to tell which of the two was right.
 */

const database = testDatabase();
const OWNER = 'note-cards-owner';

/** One note of each type, filled in enough to produce cards. */
const FIELDS: Record<NoteTypeName, Record<string, unknown>> = {
  vocab: {
    term: 'Sorgfalt',
    translation: 'care',
    partOfSpeech: 'noun',
    grammar: { article: 'die', gender: 'f' },
  },
  basic: { front: 'What is the Fisher equation?', back: 'i = r + inflation' },
  cloze: { text: 'Ich {{stehe}} früh {{auf}}.' },
};

/** What a card is, with nothing on it that changes between two runs. */
function shape(cards: readonly Card[]) {
  return cards
    .map((card) => ({
      direction: card.direction,
      slot: card.slot,
      state: card.state,
      reps: card.reps,
    }))
    .sort((left, right) =>
      `${left.direction}:${left.slot}`.localeCompare(`${right.direction}:${right.slot}`),
    );
}

describe.skipIf(!database)('card generation', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);

    const deck = await json<{ deck: Deck }>(
      await server.request('/api/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Card generation' }),
      }),
      201,
    );

    deckId = deck.deck.id;
  });

  for (const noteType of NOTE_TYPES) {
    it(`makes the same cards from the editor and from the importer, for ${noteType}`, async () => {
      if (!database) {
        return;
      }

      const typed = await json<{ note: Note; cards: Card[] }>(
        await server.request('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deckId, noteType, fields: FIELDS[noteType] }),
        }),
        201,
      );

      await json<{ import: { id: string } }>(
        await server.request('/api/imports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId,
            source: `identical-${noteType}`,
            notes: [{ noteType, fields: FIELDS[noteType] }],
          }),
        }),
        201,
      );

      const imported = (await repositories.notes.list({ deckId, search: undefined })).items.filter(
        (row) => row.source === `identical-${noteType}`,
      );

      expect(imported).toHaveLength(1);

      const importedCards = await repositories.cards.forNote(imported[0]?.id ?? '');

      expect(shape(importedCards.map(toCard))).toEqual(shape(typed.cards));
    });
  }

  it('gives a cloze sentence one card per gap', async () => {
    if (!database) {
      return;
    }

    const written = await json<{ cards: Card[] }>(
      await server.request('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId,
          noteType: 'cloze',
          fields: { text: 'Ich {{a}} und {{b}} und {{c}}.' },
        }),
      }),
      201,
    );

    expect(written.cards.map((card) => card.slot).sort()).toEqual([1, 2, 3]);
  });
});

describe.skipIf(!database)('editing a note', () => {
  let repositories: Repositories;
  let server: Hono;
  let deckId: string;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, `${OWNER}-edit`);

    repositories = repositoriesFor(database, `${OWNER}-edit`);
    server = testServer(database, `${OWNER}-edit`);

    const deck = await json<{ deck: Deck }>(
      await server.request('/api/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Editing' }),
      }),
      201,
    );

    deckId = deck.deck.id;
  });

  /** A note with one card that has been answered, which is the thing at risk. */
  async function answeredNote() {
    const written = await json<{ note: Note; cards: Card[] }>(
      await server.request('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId, noteType: 'vocab', fields: FIELDS['vocab'] }),
      }),
      201,
    );

    const card = written.cards[0];

    if (!card) {
      throw new Error('the note arrived with no cards');
    }

    // A real answer through the real path, so the card carries a schedule the
    // scheduler produced rather than one the test made up.
    await repositories.reviews.record({ cardId: card.id, rating: RATING.good, now: new Date() });

    return { noteId: written.note.id, cardId: card.id };
  }

  it('keeps the schedule when a translation is corrected', async () => {
    if (!database) {
      return;
    }

    const { noteId, cardId } = await answeredNote();

    const edited = await json<{ cards: Card[] }>(
      await server.request(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fields: { ...FIELDS['vocab'], translation: 'thoroughness' },
        }),
      }),
      200,
    );

    expect(edited.cards).toHaveLength(1);
    expect(edited.cards[0]?.id).toBe(cardId);
    expect(edited.cards[0]?.reps).toBe(1);
    expect(edited.cards[0]?.stability).toBeGreaterThan(0);
  });

  it('keeps the schedule when the note moves to another deck', async () => {
    if (!database) {
      return;
    }

    const { noteId, cardId } = await answeredNote();
    const other = await repositories.decks.create({ name: `Elsewhere ${noteId.slice(0, 8)}` });

    const moved = await json<{ cards: Card[] }>(
      await server.request(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId: other.id }),
      }),
      200,
    );

    expect(moved.cards[0]?.id).toBe(cardId);
    expect(moved.cards[0]?.deckId).toBe(other.id);
    expect(moved.cards[0]?.reps).toBe(1);
  });

  it('refuses a change of type that would throw away answers', async () => {
    if (!database) {
      return;
    }

    const { noteId } = await answeredNote();

    const response = await server.request(`/api/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ noteType: 'cloze', fields: { text: 'a {{b}} c' } }),
    });

    expect(response.status).toBe(409);

    const body = (await response.json()) as {
      error: { code: string; details?: { cards?: number; reviews?: number } };
    };

    expect(body.error.code).toBe('cards_would_be_lost');
    expect(body.error.details?.cards).toBe(1);
    expect(body.error.details?.reviews).toBe(1);
  });

  it('makes the change once it is confirmed, and says what is there now', async () => {
    if (!database) {
      return;
    }

    const { noteId, cardId } = await answeredNote();

    const changed = await json<{ note: Note; cards: Card[] }>(
      await server.request(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          noteType: 'cloze',
          fields: { text: 'a {{b}} c' },
          discardCards: true,
        }),
      }),
      200,
    );

    expect(changed.note.noteType).toBe('cloze');
    expect(changed.cards).toHaveLength(1);
    expect(changed.cards[0]?.direction).toBe('cloze');
    expect(changed.cards.map((card) => card.id)).not.toContain(cardId);
  });

  it('adds a card for a gap that was added, and keeps the others', async () => {
    if (!database) {
      return;
    }

    const written = await json<{ note: Note; cards: Card[] }>(
      await server.request('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId, noteType: 'cloze', fields: { text: 'Ich {{a}} hier.' } }),
      }),
      201,
    );

    const edited = await json<{ cards: Card[] }>(
      await server.request(`/api/notes/${written.note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: { text: 'Ich {{a}} {{b}} hier.' } }),
      }),
      200,
    );

    expect(edited.cards).toHaveLength(2);
    expect(edited.cards.map((card) => card.id)).toContain(written.cards[0]?.id);
  });

  it('refuses fields that do not match the type they are being written as', async () => {
    if (!database) {
      return;
    }

    const written = await json<{ note: Note }>(
      await server.request('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId, noteType: 'vocab', fields: FIELDS['vocab'] }),
      }),
      201,
    );

    // A type change with no fields to go with it leaves a row nothing can read
    // back, so it is refused by name rather than written.
    const response = await server.request(`/api/notes/${written.note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ noteType: 'basic' }),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_note_fields',
    );
  });
});

/** A row from the repository, in the shape the wire uses. */
function toCard(row: { direction: string; slot: number; state: string; reps: number }): Card {
  return row as unknown as Card;
}
