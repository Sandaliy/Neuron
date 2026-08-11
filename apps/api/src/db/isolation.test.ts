import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asUser,
  createUser,
  describeSkipReason,
  rawAppPool,
  rawOwnerPool,
  testDatabase,
} from './testing/database.js';

import type { Pool } from '@neondatabase/serverless';

/**
 * The second barrier around user data, checked where it lives.
 *
 * Every statement here goes straight at the database as the restricted role,
 * not through the repository layer. That is the whole point: the repositories
 * are the first barrier, and row level security exists to hold when the first
 * barrier has a bug in it. Testing it through the code it is meant to be
 * independent of would prove nothing.
 */

const database = testDatabase();

const ALICE = 'isolation-alice';
const BOB = 'isolation-bob';

const ALICE_DECK = '01920000-0000-7000-8000-0000000000a1';
const BOB_DECK = '01920000-0000-7000-8000-0000000000b1';
const BOB_NOTE = '01920000-0000-7000-8000-0000000000b2';
const BOB_CARD = '01920000-0000-7000-8000-0000000000b3';
const BOB_REVIEW = '01920000-0000-7000-8000-0000000000b4';

describe.skipIf(!database)('row level security', () => {
  let app: Pool;
  let owner: Pool;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    app = rawAppPool(database);
    owner = rawOwnerPool(database);

    await createUser(database, ALICE);
    await createUser(database, BOB);

    // Written by the owner, because the point is to have rows that exist and
    // then find out what the restricted role can do about them.
    await owner.query('insert into decks (id, user_id, name) values ($1, $2, $3), ($4, $5, $6)', [
      ALICE_DECK,
      ALICE,
      'Alice deck',
      BOB_DECK,
      BOB,
      'Bob deck',
    ]);

    await owner.query(
      `insert into notes (id, user_id, deck_id, note_type_id, fields)
       values ($1, $2, $3, (select id from note_types where name = 'vocab'), $4)`,
      [BOB_NOTE, BOB, BOB_DECK, JSON.stringify({ term: 'geheim', translation: 'secret' })],
    );

    await owner.query(
      `insert into cards (id, user_id, note_id, deck_id, direction, state, due)
       values ($1, $2, $3, $4, 'recognition', 'new', now())`,
      [BOB_CARD, BOB, BOB_NOTE, BOB_DECK],
    );

    await owner.query(
      `insert into reviews (id, user_id, card_id, reviewed_at, rating, elapsed_days, scheduled_days, placed_due, state_before)
       values ($1, $2, $3, now(), 'good', 0, 0, now(), 'new')`,
      [BOB_REVIEW, BOB, BOB_CARD],
    );
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it('shows a user only their own rows', async () => {
    const names = await asUser(app, ALICE, async (connection) => {
      const result = await connection.query<{ name: string }>('select name from decks order by name');

      return result.rows.map((row) => row.name);
    });

    expect(names).toEqual(['Alice deck']);
  });

  it('refuses to update another user’s row, without saying so', async () => {
    const affected = await asUser(app, ALICE, async (connection) => {
      const result = await connection.query('update decks set name = $1 where id = $2', [
        'taken over',
        BOB_DECK,
      ]);

      return result.rowCount;
    });

    // Zero rows rather than an error, which is how a policy declines: the row
    // is not there as far as this transaction is concerned.
    expect(affected).toBe(0);
  });

  it('refuses to delete another user’s row', async () => {
    const affected = await asUser(app, ALICE, async (connection) => {
      const result = await connection.query('delete from decks where id = $1', [BOB_DECK]);

      return result.rowCount;
    });

    expect(affected).toBe(0);
  });

  it('refuses an insert that claims to be someone else', async () => {
    await expect(
      asUser(app, ALICE, async (connection) =>
        connection.query('insert into decks (id, user_id, name) values ($1, $2, $3)', [
          '01920000-0000-7000-8000-0000000000c1',
          BOB,
          'forged',
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('reads nothing at all when no user has been named', async () => {
    const counts = await asUser(app, null, async (connection) => {
      const tables = ['decks', 'notes', 'cards', 'reviews', 'study_presets', 'import_batches'];
      const found: Record<string, number> = {};

      for (const table of tables) {
        const result = await connection.query<{ n: number }>(
          `select count(*)::int as n from ${table}`,
        );

        found[table] = result.rows[0]?.n ?? -1;
      }

      return found;
    });

    // A connection that never said who it was is the shape a bug takes: some
    // path that skipped the repository layer. It gets an empty database.
    expect(counts).toEqual({
      decks: 0,
      notes: 0,
      cards: 0,
      reviews: 0,
      study_presets: 0,
      import_batches: 0,
    });
  });

  it('hides another user’s cards and notes as well as their decks', async () => {
    const found = await asUser(app, ALICE, async (connection) => {
      const notes = await connection.query<{ n: number }>('select count(*)::int as n from notes');
      const cards = await connection.query<{ n: number }>('select count(*)::int as n from cards');

      return { notes: notes.rows[0]?.n, cards: cards.rows[0]?.n };
    });

    expect(found).toEqual({ notes: 0, cards: 0 });
  });

  it('lets everyone read the built in note types, which belong to nobody', async () => {
    const names = await asUser(app, ALICE, async (connection) => {
      const result = await connection.query<{ name: string }>(
        'select name from note_types order by name',
      );

      return result.rows.map((row) => row.name);
    });

    expect(names).toEqual(['basic', 'cloze', 'vocab']);
  });

  it('does not let a user change a built in note type', async () => {
    const affected = await asUser(app, ALICE, async (connection) => {
      const result = await connection.query('update note_types set name = $1 where name = $2', [
        'hijacked',
        'vocab',
      ]);

      return result.rowCount;
    });

    expect(affected).toBe(0);
  });
});

describe.skipIf(!database)('the review log', () => {
  let app: Pool;
  let owner: Pool;

  beforeAll(() => {
    if (database) {
      app = rawAppPool(database);
      owner = rawOwnerPool(database);
    }
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it('cannot be updated by the application role', async () => {
    await expect(
      asUser(app, BOB, async (connection) =>
        connection.query('update reviews set rating = $1 where id = $2', ['easy', BOB_REVIEW]),
      ),
    ).rejects.toThrow(/permission denied|append only/i);
  });

  it('cannot be deleted by the application role', async () => {
    await expect(
      asUser(app, BOB, async (connection) =>
        connection.query('delete from reviews where id = $1', [BOB_REVIEW]),
      ),
    ).rejects.toThrow(/permission denied|append only/i);
  });

  it('cannot be updated by the owner either', async () => {
    // The grant stops the application. This stops everyone, which is the point:
    // a privilege is only as good as the role the connection happens to use.
    await expect(
      owner.query('update reviews set rating = $1 where id = $2', ['easy', BOB_REVIEW]),
    ).rejects.toThrow(/append only/i);
  });

  it('cannot be deleted by the owner either', async () => {
    await expect(owner.query('delete from reviews where id = $1', [BOB_REVIEW])).rejects.toThrow(
      /append only/i,
    );
  });

  it('can still be removed when an account is being erased', async () => {
    // The one legitimate delete. Without this the cascade from removing a user
    // would hit the trigger and make deleting an account impossible, which is a
    // worse failure than the one the trigger prevents.
    const connection = await owner.connect();

    try {
      await connection.query('begin');
      await connection.query("select set_config('app.erasing_account', 'on', true)");

      const result = await connection.query('delete from reviews where id = $1', [BOB_REVIEW]);

      expect(result.rowCount).toBe(1);

      await connection.query('rollback');
    } finally {
      connection.release();
    }
  });
});

describe.skipIf(!database)('what the application role may do', () => {
  let app: Pool;

  beforeAll(() => {
    if (database) {
      app = rawAppPool(database);
    }
  });

  afterAll(async () => {
    await app?.end();
  });

  it('is not the database owner', async () => {
    const result = await app.query<{ current_user: string }>('select current_user');

    expect(result.rows[0]?.current_user).toBe('neuron_app');
  });

  it('cannot bypass row level security', async () => {
    const result = await app.query<{ rolbypassrls: boolean }>(
      'select rolbypassrls from pg_roles where rolname = current_user',
    );

    // The attribute Neon grants its owner role. With it, every policy in this
    // file would pass while protecting nothing.
    expect(result.rows[0]?.rolbypassrls).toBe(false);
  });

  it('cannot create a table', async () => {
    await expect(app.query('create table smuggled (x int)')).rejects.toThrow(/permission denied/i);
  });

  it('cannot drop a table', async () => {
    await expect(app.query('drop table cards')).rejects.toThrow(/must be owner/i);
  });

  it('cannot turn a policy off', async () => {
    await expect(app.query('alter table decks disable row level security')).rejects.toThrow(
      /must be owner/i,
    );
  });
});

if (!database) {
  describe('database tests', () => {
    it.skip(describeSkipReason(), () => {
      // Skipped on purpose, and named so that a run without a test database
      // says so on screen rather than quietly reporting everything as passing.
    });
  });
}
