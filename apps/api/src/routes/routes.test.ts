import { beforeAll, describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';
import type { Card, Deck, DeckNode, Note } from '@neuron/shared';

import { createUser, repositoriesFor, testDatabase } from '../db/testing/database.js';
import { json, signedOutServer, testServer } from '../testing/server.js';

import type { Repositories } from '../db/repositories/index.js';
import type { Hono } from 'hono';

/**
 * The routes, over the real database.
 *
 * The interesting ones are the tree with its counts, which is the first screen
 * of the app and the slowest query in the schema, and the shape of a refusal,
 * which is what a person actually sees when something goes wrong.
 */

const database = testDatabase();
const OWNER = 'routes-owner';

describe.skipIf(!database)('the routes', () => {
  let repositories: Repositories;
  let server: Hono;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    await createUser(database, OWNER);

    repositories = repositoriesFor(database, OWNER);
    server = testServer(database, OWNER);
  });

  describe('signing in', () => {
    it('refuses everything without a session, in the shape everything else uses', async () => {
      if (!database) {
        return;
      }

      const response = await signedOutServer(database).request('/decks');

      expect(response.status).toBe(401);

      const body = (await response.json()) as { error: { code: string; correlationId: string } };

      expect(body.error.code).toBe('not_authenticated');
      expect(body.error.correlationId).toBeTruthy();
    });
  });

  describe('decks', () => {
    it('creates a deck and gives it back', async () => {
      const body = await json<{ deck: Deck }>(
        await server.request('/decks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'German' }),
        }),
        201,
      );

      expect(body.deck.name).toBe('German');
      expect(body.deck.path).toEqual([]);
    });

    it('rolls the counts up the tree, in one query rather than one per deck', async () => {
      /**
       * The library screen.
       *
       * A folder shows what is waiting underneath it, at any depth. Getting
       * this wrong is felt on the first screen of the app rather than
       * eventually, which is why the counts come from a single grouped query
       * and are added up here rather than asked for per deck.
       */
      const root = await repositories.decks.create({ name: 'Counting' });
      const child = await repositories.decks.create({ name: 'Lesson 1', parentId: root.id });
      const grandchild = await repositories.decks.create({ name: 'Part A', parentId: child.id });

      const note = await repositories.notes.create({
        deckId: grandchild.id,
        noteType: 'vocab',
        fields: { term: 'tief', translation: 'deep' },
      });

      await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(),
      });

      const body = await json<{ decks: DeckNode[] }>(await server.request('/decks'), 200);
      const counting = body.decks.find((deck) => deck.id === root.id);

      expect(counting?.fresh).toBe(1);
      expect(counting?.children[0]?.children[0]?.fresh).toBe(1);
    });

    it('does not count a suspended card as waiting', async () => {
      const deck = await repositories.decks.create({ name: 'Suspended counting' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'ruhig', translation: 'quiet' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(),
      });

      await repositories.cards.suspend(card.id);

      const body = await json<{ decks: DeckNode[] }>(await server.request('/decks'), 200);
      const found = body.decks.find((entry) => entry.id === deck.id);

      expect(found?.fresh).toBe(0);
    });

    it('refuses to move a deck into its own child, and says which refusal it was', async () => {
      const parent = await repositories.decks.create({ name: 'Cycle top' });
      const child = await repositories.decks.create({ name: 'Cycle bottom', parentId: parent.id });

      const response = await server.request(`/decks/${parent.id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentId: child.id }),
      });

      expect(response.status).toBe(409);

      const body = (await response.json()) as { error: { code: string } };

      expect(body.error.code).toBe('deck_cycle');
    });

    it('turns a duplicate sibling name into a code the client can translate', async () => {
      const parent = await repositories.decks.create({ name: 'Naming' });

      await repositories.decks.create({ name: 'Lesson', parentId: parent.id });

      const response = await server.request('/decks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'lesson', parentId: parent.id }),
      });

      expect(response.status).toBe(409);

      const body = (await response.json()) as { error: { code: string } };

      expect(body.error.code).toBe('name_taken');
    });

    it('takes a delete back', async () => {
      const deck = await repositories.decks.create({ name: 'Regret' });
      const child = await repositories.decks.create({ name: 'Also regret', parentId: deck.id });

      await json(await server.request(`/decks/${deck.id}`, { method: 'DELETE' }), 200);

      expect(await repositories.decks.byId(deck.id)).toBeUndefined();

      await json(await server.request(`/decks/${deck.id}/restore`, { method: 'POST' }), 200);

      expect(await repositories.decks.byId(deck.id)).toBeDefined();
      expect(await repositories.decks.byId(child.id)).toBeDefined();
    });
  });

  describe('notes', () => {
    let deckId: string;

    beforeAll(async () => {
      if (!database) {
        return;
      }

      deckId = (await repositories.decks.create({ name: 'Notes' })).id;
    });

    it('creates the first card along with the note', async () => {
      // A note with no cards is invisible to the person who wrote it, so the
      // two cannot arrive separately. Only the first rung of the ladder opens:
      // three cards on day one triples the work of day one.
      const body = await json<{ note: Note; cards: Card[] }>(
        await server.request('/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId,
            noteType: 'vocab',
            fields: { term: 'der Anfang', translation: 'the beginning' },
          }),
        }),
        201,
      );

      expect(body.note.noteType).toBe('vocab');
      expect(body.cards).toHaveLength(1);
      expect(body.cards[0]?.direction).toBe('recognition');
    });

    it('gives a cloze note the card it can actually produce', async () => {
      // The default ladder talks about recognition and recall. A cloze note
      // produces neither. Without the fallback it would be created with no
      // cards at all, which looks exactly like it not being created.
      const body = await json<{ cards: Card[] }>(
        await server.request('/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId,
            noteType: 'cloze',
            fields: { text: 'Ich {{gehe}} nach Hause' },
          }),
        }),
        201,
      );

      expect(body.cards).toHaveLength(1);
      expect(body.cards[0]?.direction).toBe('cloze');
    });

    it('names the field that was wrong without quoting what was typed', async () => {
      const response = await server.request('/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId,
          noteType: 'vocab',
          fields: { term: 'kein Wort' },
        }),
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as {
        error: { code: string; details?: { fields?: { path: string }[] } };
      };

      expect(body.error.code).toBe('invalid_note_fields');
      expect(body.error.details?.fields?.[0]?.path).toBe('translation');

      // Nothing the person typed is in the answer, because an error that
      // echoes its input is an error that puts a person's cards in a log.
      expect(JSON.stringify(body)).not.toContain('kein Wort');
    });

    it('pages by cursor, so a deletion between two pages does not skip a row', async () => {
      const paging = await repositories.decks.create({ name: 'Paging' });

      for (let index = 0; index < 5; index += 1) {
        await repositories.notes.create({
          deckId: paging.id,
          noteType: 'basic',
          fields: { front: `front ${index}`, back: `back ${index}` },
        });
      }

      const first = await json<{ items: Note[]; nextCursor?: string }>(
        await server.request(`/notes?deckId=${paging.id}&limit=2`),
        200,
      );

      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();

      const second = await json<{ items: Note[] }>(
        await server.request(`/notes?deckId=${paging.id}&limit=2&cursor=${first.nextCursor}`),
        200,
      );

      expect(second.items).toHaveLength(2);
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    });

    it('changes many at once and reports how many moved', async () => {
      const bulk = await repositories.decks.create({ name: 'Bulk' });
      const ids: string[] = [];

      for (let index = 0; index < 3; index += 1) {
        const note = await repositories.notes.create({
          deckId: bulk.id,
          noteType: 'basic',
          fields: { front: `bulk ${index}`, back: 'x' },
        });

        ids.push(note.id);
      }

      const body = await json<{ changed: number }>(
        await server.request('/notes/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, status: 'known' }),
        }),
        200,
      );

      expect(body.changed).toBe(3);
    });
  });

  describe('cards', () => {
    it('opens a direction the ladder has not reached, and refuses one twice', async () => {
      const deck = await repositories.decks.create({ name: 'Unlocking' });
      const created = await json<{ note: Note; cards: Card[] }>(
        await server.request('/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId: deck.id,
            noteType: 'vocab',
            fields: { term: 'die Wahl', translation: 'the choice' },
          }),
        }),
        201,
      );

      const opened = await json<{ card: Card }>(
        await server.request(`/notes/${created.note.id}/cards`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ direction: 'recall' }),
        }),
        201,
      );

      expect(opened.card.direction).toBe('recall');

      const again = await server.request(`/notes/${created.note.id}/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'recall' }),
      });

      expect(again.status).toBe(409);
    });

    it('refuses a direction the note cannot produce', async () => {
      // A listening card needs audio. Without it the direction is not something
      // the note can be asked in, however much anyone would like it to be.
      const deck = await repositories.decks.create({ name: 'No audio' });
      const created = await json<{ note: Note }>(
        await server.request('/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId: deck.id,
            noteType: 'vocab',
            fields: { term: 'stumm', translation: 'silent' },
          }),
        }),
        201,
      );

      const response = await server.request(`/notes/${created.note.id}/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'listening' }),
      });

      expect(response.status).toBe(409);

      const body = (await response.json()) as { error: { code: string } };

      expect(body.error.code).toBe('direction_unavailable');
    });

    it('keeps a suspended card out of what is due', async () => {
      const deck = await repositories.decks.create({ name: 'Aside' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'beiseitegelegt', translation: 'put aside' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(Date.now() - 1000),
      });

      await json(await server.request(`/cards/${card.id}/suspend`, { method: 'POST' }), 200);

      const due = await json<{ cards: Card[] }>(
        await server.request(`/cards/due?deckId=${deck.id}`),
        200,
      );

      expect(due.cards.some((entry) => entry.id === card.id)).toBe(false);

      await json(await server.request(`/cards/${card.id}/unsuspend`, { method: 'POST' }), 200);

      const after = await json<{ cards: Card[] }>(
        await server.request(`/cards/due?deckId=${deck.id}`),
        200,
      );

      expect(after.cards.some((entry) => entry.id === card.id)).toBe(true);
    });

    it('starts a card over without losing a single row of its log', async () => {
      /**
       * Resetting cannot delete a review, because the log is append only and
       * that is the whole point of it. What moves is the line the replay starts
       * from. Rebuilding the card afterwards has to produce the reset card, not
       * quietly undo the reset.
       */
      const deck = await repositories.decks.create({ name: 'Starting over' });
      const note = await repositories.notes.create({
        deckId: deck.id,
        noteType: 'vocab',
        fields: { term: 'wieder', translation: 'again' },
      });
      const card = await repositories.cards.create({
        noteId: note.id,
        direction: 'recognition',
        due: new Date(),
      });

      await repositories.reviews.record({ cardId: card.id, rating: 3, now: new Date() });
      await repositories.reviews.record({ cardId: card.id, rating: 3, now: new Date() });

      const body = await json<{ card: Card }>(
        await server.request(`/cards/${card.id}/reset`, { method: 'POST' }),
        200,
      );

      expect(body.card.state).toBe('new');
      expect(body.card.reps).toBe(0);
      expect(body.card.stability).toBeNull();

      // The rows are still there. They just no longer count towards this card.
      const stillThere = await repositories.reviews.forCard(card.id);

      expect(stillThere).toHaveLength(0);

      const rebuilt = await repositories.reviews.rebuild(card.id);

      expect(rebuilt.state).toBe('new');
    });
  });

  describe('imports', () => {
    it('writes a batch and takes it back whole', async () => {
      const deck = await repositories.decks.create({ name: 'Imported' });

      const created = await json<{ import: { id: string }; notes: number; cards: number }>(
        await server.request('/imports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            deckId: deck.id,
            source: 'Oxford 5000',
            notes: [
              { noteType: 'vocab', fields: { term: 'eins', translation: 'one' }, rank: 1 },
              { noteType: 'vocab', fields: { term: 'zwei', translation: 'two' }, rank: 2 },
            ],
          }),
        }),
        201,
      );

      expect(created.notes).toBe(2);
      expect(created.cards).toBe(2);

      const undone = await json<{ undone: number }>(
        await server.request(`/imports/${created.import.id}/undo`, { method: 'POST' }),
        200,
      );

      expect(undone.undone).toBe(2);

      const left = await repositories.notes.inDeck(deck.id);

      expect(left).toHaveLength(0);
    });

    it('writes nothing at all when one row of the import is wrong', async () => {
      const deck = await repositories.decks.create({ name: 'Bad import' });

      const response = await server.request('/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deckId: deck.id,
          source: 'Half a list',
          notes: [
            { noteType: 'vocab', fields: { term: 'gut', translation: 'good' } },
            { noteType: 'vocab', fields: { term: 'schlecht' } },
          ],
        }),
      });

      expect(response.status).toBe(400);
      expect(await repositories.notes.inDeck(deck.id)).toHaveLength(0);
      expect(await repositories.importBatches.list()).not.toContainEqual(
        expect.objectContaining({ source: 'Half a list' }),
      );
    });
  });

  describe('the api description', () => {
    it('is generated from the schemas the routes validate with', async () => {
      const document = await json<{
        openapi: string;
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      }>(await server.request('/docs'), 200);

      expect(document.openapi).toBe('3.1.0');
      expect(Object.keys(document.paths).length).toBeGreaterThan(20);
      expect(document.components.schemas['SubmitReview']).toBeDefined();
    });

    it('is not readable without a session', async () => {
      if (!database) {
        return;
      }

      const response = await signedOutServer(database).request('/docs');

      expect(response.status).toBe(401);
    });
  });

  describe('addresses that are not there', () => {
    it('answers in the same shape as everything else', async () => {
      const response = await server.request('/nowhere');

      expect(response.status).toBe(404);

      const body = (await response.json()) as { error: { code: string } };

      expect(body.error.code).toBe('not_found');
    });

    it('refuses an id that is not a uuid without touching the database', async () => {
      const response = await server.request('/decks/not-a-uuid');

      expect(response.status).toBe(400);
    });

    it('does not say whether somebody else’s row exists', async () => {
      const response = await server.request(`/decks/${uuidV7()}`);

      expect(response.status).toBe(404);
    });
  });
});
