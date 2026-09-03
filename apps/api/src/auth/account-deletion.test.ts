import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuidV7 } from '@neuron/shared';

import { describeAuthSkipReason, rawOwnerPool, testDatabase } from '../db/testing/database.js';

import {
  CookieJar,
  GOOD_PASSWORD,
  harnessFor,
  register,
  registerFresh,
  signIn,
  uniqueAddress,
} from './testing/harness.js';

import type { Harness } from './testing/harness.js';
import type { TestDatabase } from '../db/testing/database.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * Leaving, through the whole stack rather than through a stubbed session.
 *
 * Deleting an account does not delete anything. It anonymises the person, drops
 * their credentials, closes their sessions, marks the row, and soft deletes the
 * collection. The rows go thirty days later, in a task run as the database
 * owner, which is the only connection allowed to remove a review.
 *
 * The isolation tests cover that at the database. What is covered here is the
 * same claim from the outside: after somebody leaves, their review log is still
 * there and nothing in the request path can reach it.
 *
 * The database is shared with every other file in the run and is never emptied
 * here, so every person is minted fresh and every query is scoped to one of
 * them.
 */

const database = testDatabase();

describe.skipIf(!database)('leaving', () => {
  const testDb = database as TestDatabase;
  const hasAuthRole = Boolean(database?.authUrl);
  let owner: Pool;

  beforeAll(() => {
    if (!hasAuthRole) {
      console.warn(describeAuthSkipReason());
    }

    owner = rawOwnerPool(testDb);
  });

  afterAll(async () => {
    await owner.end();
  });

  /**
   * Signs somebody up and has them answer one card, so there is history.
   *
   * Through the api, the way a person would, rather than by writing rows. The
   * claim being tested is about what survives a deletion, and rows written by
   * hand would not have gone through the code that writes the real ones.
   */
  async function withOneReview(
    harness: Harness,
    label: string,
  ): Promise<{ jar: CookieJar; recoveryCodes: string[]; userId: string; email: string }> {
    const person = await registerFresh(harness, label);
    const jar = person.jar;

    const deck = await harness.post<{ deck: { id: string } }>(
      '/api/decks',
      { name: 'Leaving' },
      { jar },
    );

    expect(deck.status).toBe(201);

    const note = await harness.post<{ id: string }>(
      '/api/notes',
      {
        deckId: deck.body.deck.id,
        noteType: 'vocab',
        fields: { term: 'ушёл', translation: 'left' },
      },
      { jar },
    );

    expect(note.status).toBe(201);

    const due = await harness.get<{ cards: { id: string }[] }>('/api/cards/due?limit=5', { jar });
    const card = due.body.cards[0];

    expect(card).toBeDefined();

    const review = await harness.post(
      '/api/reviews',
      {
        id: uuidV7(),
        cardId: card?.id,
        rating: 'good',
        reviewedAt: new Date().toISOString(),
        durationMs: 1200,
      },
      { jar },
    );

    expect(review.status).toBe(200);

    return {
      jar,
      recoveryCodes: person.recoveryCodes,
      userId: person.userId,
      email: person.email,
    };
  }

  /** How many reviews one person's log holds. */
  async function countReviews(userId: string): Promise<number | undefined> {
    const result = await owner.query<{ n: number }>(
      'select count(*)::int as n from reviews where user_id = $1',
      [userId],
    );

    return result.rows[0]?.n;
  }

  describe.skipIf(!hasAuthRole)('the price of leaving', () => {
    it('refuses without the password', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'nopassword');

      const refused = await harness.request('DELETE', '/api/account', {
        jar: person.jar,
        body: { password: 'not the right one at all' },
      });

      expect(refused.status).toBeGreaterThanOrEqual(400);

      // Nothing happened. The session still opens the account it opened before.
      expect((await harness.get('/api/account', { jar: person.jar })).status).toBe(200);
      expect(await countReviews(person.userId)).toBe(1);
    });

    it('refuses a body with no password in it at all', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'nobody');

      const refused = await harness.request('DELETE', '/api/account', {
        jar: person.jar,
        body: {},
      });

      expect(refused.status).toBe(400);
      expect((await harness.get('/api/account', { jar: person.jar })).status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('after somebody has gone', () => {
    it('keeps the review log', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'goodbye');
      const jar = person.jar;

      const before = await countReviews(person.userId);

      expect(before).toBe(1);

      const left = await harness.request('DELETE', '/api/account', {
        jar,
        body: { password: GOOD_PASSWORD },
      });

      expect(left.status).toBe(200);

      // Still there. The row goes thirty days later, run as the owner, which is
      // the only thing that can remove a review at all.
      expect(await countReviews(person.userId)).toBe(1);
    });

    it('leaves nothing in the request path that can reach it', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'unreachable');
      const jar = person.jar;

      await harness.request('DELETE', '/api/account', {
        jar,
        body: { password: GOOD_PASSWORD },
      });

      // The session that made the request is gone with everything else, so the
      // cookie in hand opens nothing.
      expect((await harness.get('/api/account', { jar })).status).toBe(401);
      expect((await harness.get('/api/cards/due', { jar })).status).toBe(401);

      // And the password no longer signs anybody in, because the credential row
      // was removed rather than marked.
      expect(
        (await signIn(harness, person.email, GOOD_PASSWORD)).answer.status,
      ).toBeGreaterThanOrEqual(400);
    });

    it('takes the recovery codes with it', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'nocodes');
      const jar = person.jar;

      await harness.request('DELETE', '/api/account', {
        jar,
        body: { password: GOOD_PASSWORD },
      });

      // A code that still worked after the account was deleted would be a way
      // back into a collection its owner asked to be rid of.
      const used = await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(used.status).toBeGreaterThanOrEqual(400);
    });

    it('leaves no address on the row', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'anonymous');
      const jar = person.jar;

      await harness.request('DELETE', '/api/account', {
        jar,
        body: { password: GOOD_PASSWORD },
      });

      const row = await owner.query<{ email: string; name: string; deletion_requested_at: Date }>(
        'select email, name, deletion_requested_at from "user" where id = $1',
        [person.userId],
      );

      expect(row.rows[0]?.email).not.toContain(person.email);
      expect(row.rows[0]?.name).toBe('Deleted account');
      expect(row.rows[0]?.deletion_requested_at).toBeTruthy();
    });

    it('frees the address, so somebody can sign up with it again', async () => {
      const harness = harnessFor(testDb);
      const person = await withOneReview(harness, 'reusable');
      const jar = person.jar;

      await harness.request('DELETE', '/api/account', {
        jar,
        body: { password: GOOD_PASSWORD },
      });

      const again = await register(harness, person.email, { address: uniqueAddress() });

      expect(again.answer.status).toBe(200);

      // A fresh, empty collection. The old one is still on its own row, waiting
      // out its thirty days.
      const decks = await harness.get<{ decks: unknown[] }>('/api/decks', { jar: again.jar });

      expect(decks.body.decks).toHaveLength(0);
    });
  });
});
