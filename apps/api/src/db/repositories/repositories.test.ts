import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSeededRandom, replay, createSchedulerConfig } from '@neuron/core';

import {
  asUser,
  createUser,
  rawAppPool,
  repositoriesFor,
  testDatabase,
} from '../testing/database.js';

import { DeckCycle } from './decks.js';
import { toSchedulingState } from './mapping.js';

import type { Repositories } from './index.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * The repository layer, against a real database.
 *
 * These go through the repositories rather than around them, which is the
 * opposite of isolation.test.ts and for the opposite reason: here the thing
 * under test is the code, and the database is the environment it has to work
 * in.
 */

const database = testDatabase();
const OWNER = 'repo-owner';

describe.skipIf(!database)('the repositories', () => {
  let repositories: Repositories;
  let app: Pool;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);
    repositories = repositoriesFor(database, OWNER);
    app = rawAppPool(database);
  });

  afterAll(async () => {
    await app?.end();
  });

  describe('the deck tree', () => {
    it('records the ancestors of a deck as it is created', async () => {
      const root = await repositories.decks.create({ name: 'Languages' });
      const child = await repositories.decks.create({ name: 'German', parentId: root.id });
      const grandchild = await repositories.decks.create({ name: 'Lesson 1', parentId: child.id });

      expect(root.path).toEqual([]);
      expect(child.path).toEqual([root.id]);
      expect(grandchild.path).toEqual([root.id, child.id]);
    });

    it('rewrites every descendant when a subtree moves', async () => {
      const oldHome = await repositories.decks.create({ name: 'Old home' });
      const newHome = await repositories.decks.create({ name: 'New home' });
      const moving = await repositories.decks.create({ name: 'Moving', parentId: oldHome.id });
      const child = await repositories.decks.create({ name: 'Child', parentId: moving.id });
      const grandchild = await repositories.decks.create({ name: 'Grandchild', parentId: child.id });

      await repositories.decks.move(moving.id, newHome.id);

      const after = new Map((await repositories.decks.list()).map((deck) => [deck.id, deck]));

      expect(after.get(moving.id)?.path).toEqual([newHome.id]);
      expect(after.get(child.id)?.path).toEqual([newHome.id, moving.id]);
      expect(after.get(grandchild.id)?.path).toEqual([newHome.id, moving.id, child.id]);
    });

    it('rewrites paths when a subtree moves up to the root', async () => {
      const parent = await repositories.decks.create({ name: 'Parent to leave' });
      const moving = await repositories.decks.create({ name: 'Going up', parentId: parent.id });
      const child = await repositories.decks.create({ name: 'Coming along', parentId: moving.id });

      await repositories.decks.move(moving.id, null);

      const after = new Map((await repositories.decks.list()).map((deck) => [deck.id, deck]));

      expect(after.get(moving.id)?.path).toEqual([]);
      expect(after.get(moving.id)?.parentId).toBeNull();
      expect(after.get(child.id)?.path).toEqual([moving.id]);
    });

    it('refuses to move a deck into its own child', async () => {
      const parent = await repositories.decks.create({ name: 'Cycle parent' });
      const child = await repositories.decks.create({ name: 'Cycle child', parentId: parent.id });

      await expect(repositories.decks.move(parent.id, child.id)).rejects.toThrow(DeckCycle);
    });

    it('refuses to move a deck into itself', async () => {
      const deck = await repositories.decks.create({ name: 'Self move' });

      await expect(repositories.decks.move(deck.id, deck.id)).rejects.toThrow(DeckCycle);
    });

    it('refuses two siblings with the same name, whatever the case', async () => {
      const parent = await repositories.decks.create({ name: 'Names' });

      await repositories.decks.create({ name: 'Lesson', parentId: parent.id });

      await expect(
        repositories.decks.create({ name: 'lesson', parentId: parent.id }),
      ).rejects.toThrow();
    });

    it('frees the name again once the deck is deleted', async () => {
      const parent = await repositories.decks.create({ name: 'Freeing' });
      const first = await repositories.decks.create({ name: 'Repeated', parentId: parent.id });

      await repositories.decks.softDelete(first.id);

      const second = await repositories.decks.create({ name: 'Repeated', parentId: parent.id });

      expect(second.id).not.toBe(first.id);
    });

    it('marks a whole subtree as deleted and stops listing it', async () => {
      const root = await repositories.decks.create({ name: 'Doomed' });
      const child = await repositories.decks.create({ name: 'Doomed child', parentId: root.id });

      const marked = await repositories.decks.softDelete(root.id);

      expect(marked).toBe(2);
      expect(await repositories.decks.byId(child.id)).toBeUndefined();

      // Marked, not removed. A delete that cannot be undone is a delete nobody
      // trusts, so the row is still there.
      const stillThere = await asUser(app, OWNER, async (connection) => {
        const result = await connection.query<{ n: number }>(
          'select count(*)::int as n from decks where id = $1 and deleted_at is not null',
          [child.id],
        );

        return result.rows[0]?.n;
      });

      expect(stillThere).toBe(1);
    });

    it('reads the chain from the root down, for resolving settings', async () => {
      const root = await repositories.decks.create({
        name: 'Chain root',
        settings: { maximumNewCardsPerDay: 40 },
      });
      const middle = await repositories.decks.create({ name: 'Chain middle', parentId: root.id });
      const leaf = await repositories.decks.create({ name: 'Chain leaf', parentId: middle.id });

      const chain = await repositories.decks.chain(leaf.id);

      expect(chain.map((deck) => deck.name)).toEqual(['Chain root', 'Chain middle', 'Chain leaf']);
    });
  });

  describe('notes and their cards', () => {
    it('refuses fields that do not match the note type', async () => {
      const deck = await repositories.decks.create({ name: 'Validation' });

      await expect(
        repositories.notes.create({
          deckId: deck.id,
          noteType: 'vocab',
          // A vocab note without a translation is not a vocab note. Postgres
          // has no opinion about the shape of jsonb, so this has to be caught
          // before the write.
          fields: { term: 'nur ein Wort' } as never,
        }),
      ).rejects.toThrow();
    });

    it('refuses a cloze note with no gap in it', async () => {
      const deck = await repositories.decks.create({ name: 'Cloze validation' });

      await expect(
        repositories.notes.create({
          deckId: deck.id,
          noteType: 'cloze',
          fields: { text: 'nothing hidden here' },
        }),
      ).rejects.toThrow();
    });

    it('takes cards with a note when it moves to another deck', async () => {
      const from = await repositories.decks.create({ name: 'From deck' });
      const to = await repositories.decks.create({ name: 'To deck' });

      const note = await repositories.notes.create({
        deckId: from.id,
        noteType: 'vocab',
        fields: { term: 'der Umzug', translation: 'the move' },
      });

      await repositories.cards.createMany([
        { noteId: note.id, direction: 'recognition', due: new Date() },
        { noteId: note.id, direction: 'recall', due: new Date() },
      ]);

      await repositories.notes.moveToDeck(note.id, to.id);

      // The deck is copied onto the card for the sake of two queries, so this
      // is the test that keeps the copy honest.
      const cards = await repositories.cards.forNote(note.id);

      expect(cards).toHaveLength(2);
      expect(cards.map((card) => card.deckId)).toEqual([to.id, to.id]);
    });

    it('finds cards due inside a folder, at any depth', async () => {
      const folder = await repositories.decks.create({ name: 'Deep folder' });
      const middle = await repositories.decks.create({ name: 'Deep middle', parentId: folder.id });
      const leaf = await repositories.decks.create({ name: 'Deep leaf', parentId: middle.id });

      const note = await repositories.notes.create({
        deckId: leaf.id,
        noteType: 'vocab',
        fields: { term: 'tief', translation: 'deep' },
      });

      const yesterday = new Date(Date.now() - 86_400_000);

      await repositories.cards.create({ noteId: note.id, direction: 'recognition', due: yesterday });

      const due = await repositories.cards.due({ now: new Date(), deckId: folder.id });

      expect(due.map((card) => card.noteId)).toContain(note.id);
    });

    it('hides a deleted note and its cards from ordinary reads', async () => {
      const deck = await repositories.decks.create({ name: 'Hiding' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'basic',
        fields: { front: 'question', back: 'answer' },
      });

      await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(Date.now() - 1000),
      });

      await repositories.notes.softDelete(note.id);

      expect(await repositories.notes.byId(note.id)).toBeUndefined();
      expect(await repositories.cards.forNote(note.id)).toEqual([]);
      expect((await repositories.cards.due({ now: new Date() })).map((card) => card.noteId)).not.toContain(
        note.id,
      );
    });
  });

  describe('the version counter', () => {
    it('hands out a higher number on every write', async () => {
      const first = await repositories.decks.create({ name: 'Rev one' });
      const second = await repositories.decks.create({ name: 'Rev two' });

      expect(second.rev).toBeGreaterThan(first.rev);
    });

    it('gives every concurrent write its own number, with no gaps', async () => {
      const before = await repositories.decks.create({ name: 'Before the race' });

      const created = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          repositories.decks.create({ name: `Racer ${index}` }),
        ),
      );

      const revisions = created.map((deck) => deck.rev).sort((left, right) => left - right);

      // Unique, because the counter is taken under a row lock rather than read
      // and then written. Two devices syncing at once is exactly this race.
      expect(new Set(revisions).size).toBe(8);

      // And contiguous, which is what lets a client ask for "everything after
      // the number I last saw" and be sure nothing slipped between two of them.
      for (let index = 1; index < revisions.length; index += 1) {
        expect(revisions[index]).toBe((revisions[index - 1] ?? 0) + 1);
      }

      expect(revisions[0]).toBeGreaterThan(before.rev);
    });
  });

  describe('what the database refuses to store', () => {
    it('rejects a difficulty outside one to ten', async () => {
      const deck = await repositories.decks.create({ name: 'Bad difficulty' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'schwer', translation: 'hard' },
      });

      await expect(
        asUser(app, OWNER, async (connection) =>
          connection.query(
            `insert into cards (id, user_id, note_id, deck_id, direction, state, stability, difficulty, due, last_review)
             values (gen_random_uuid(), $1, $2, $3, 'recognition', 'review', 10, 15, now(), now())`,
            [OWNER, note.id, deck.id],
          ),
        ),
      ).rejects.toThrow(/cards_difficulty_range/);
    });

    it('rejects a stability of zero, which would look like an answer', async () => {
      const deck = await repositories.decks.create({ name: 'Bad stability' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'null', translation: 'zero' },
      });

      await expect(
        asUser(app, OWNER, async (connection) =>
          connection.query(
            `insert into cards (id, user_id, note_id, deck_id, direction, state, stability, difficulty, due, last_review)
             values (gen_random_uuid(), $1, $2, $3, 'recognition', 'review', 0, 5, now(), now())`,
            [OWNER, note.id, deck.id],
          ),
        ),
      ).rejects.toThrow(/cards_stability_positive/);
    });

    it('rejects a new card that carries a memory state', async () => {
      const deck = await repositories.decks.create({ name: 'Contradiction' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'neu', translation: 'new' },
      });

      // This is the union type from packages/core, written as a constraint. A
      // new card has no memory, and a card with memory is not new.
      await expect(
        asUser(app, OWNER, async (connection) =>
          connection.query(
            `insert into cards (id, user_id, note_id, deck_id, direction, state, stability, difficulty, due, last_review)
             values (gen_random_uuid(), $1, $2, $3, 'recognition', 'new', 12, 5, now(), now())`,
            [OWNER, note.id, deck.id],
          ),
        ),
      ).rejects.toThrow(/cards_new_has_no_memory/);
    });

    it('rejects a direction the scheduler does not know', async () => {
      const deck = await repositories.decks.create({ name: 'Bad direction' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'was', translation: 'what' },
      });

      await expect(
        asUser(app, OWNER, async (connection) =>
          connection.query(
            `insert into cards (id, user_id, note_id, deck_id, direction, state, due)
             values (gen_random_uuid(), $1, $2, $3, 'telepathy', 'new', now())`,
            [OWNER, note.id, deck.id],
          ),
        ),
      ).rejects.toThrow(/cards_direction_known/);
    });
  });

  describe('recording an answer', () => {
    it('writes the log and moves the card in one go', async () => {
      const deck = await repositories.decks.create({ name: 'Answering' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'die Antwort', translation: 'the answer' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(),
      });

      const outcome = await repositories.reviews.record({
        cardId: card.id,
        rating: 3,
        now: new Date(),
        durationMs: 4200,
        rng: createSeededRandom(7),
      });

      expect(outcome.card.state).not.toBe('new');
      expect(outcome.card.reps).toBe(1);
      expect(outcome.review.rating).toBe('good');
      expect(outcome.card.due.getTime()).toBe(outcome.review.placedDue.getTime());
    });

    it('rebuilds the card from its log, to the last digit', async () => {
      const deck = await repositories.decks.create({ name: 'Round trip' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'die Wiederholung', translation: 'the repetition' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(),
      });

      const rng = createSeededRandom(99);
      const ratings = [3, 4, 3, 1, 3, 2, 3, 3] as const;

      let at = new Date(Date.now() - 60 * 86_400_000);
      let stored = card;

      for (const rating of ratings) {
        const outcome = await repositories.reviews.record({
          cardId: card.id,
          rating,
          now: at,
          durationMs: 5000,
          rng,
        });

        stored = outcome.card;
        at = new Date(outcome.card.due.getTime() + 3_600_000);
      }

      const logs = await repositories.reviews.forCard(card.id);
      const rebuilt = replay(
        logs,
        createSchedulerConfig({ timezone: 'Europe/Moscow', dayCutoffHour: 4 }),
      );

      expect(logs).toHaveLength(ratings.length);

      // Exact equality, not a tolerance. Stability is a double, and a column
      // that rounded it would put two devices on different due dates within a
      // few months. That failure is silent, so it is checked here where it is
      // loud.
      expect(rebuilt.stability).toBe(stored.stability);
      expect(rebuilt.difficulty).toBe(stored.difficulty);
      expect(rebuilt.state).toBe(stored.state);
      expect(rebuilt.due.getTime()).toBe(stored.due.getTime());
      expect(rebuilt.reps).toBe(stored.reps);
      expect(rebuilt.lapses).toBe(stored.lapses);

      // And the same thing through the repository, which is how the application
      // would ever do it.
      const throughRepository = await repositories.reviews.rebuild(card.id);

      expect(throughRepository).toEqual(toSchedulingState(stored));
    });
  });
});
