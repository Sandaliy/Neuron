import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSchedulerConfig, replay } from '@neuron/core';

import { createRepositories } from '../repositories/index.js';
import { toSchedulingState } from '../repositories/mapping.js';
import { appClient, rawOwnerPool, testDatabase } from '../testing/database.js';

import { DEMO_USER_ID, runSeed } from './main.js';

import type { Repositories } from '../repositories/index.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * The seed, run against the throwaway database.
 *
 * Two things are worth checking. That running it again leaves the same
 * collection rather than a second copy, because a seed that doubles its data
 * every time is a seed nobody dares run. And that the card rows it wrote really
 * are what the review log says they should be, which is the claim the whole
 * sync design rests on and the reason the seed derives state from the log
 * instead of inventing it.
 */

const database = testDatabase();

interface Counts {
  readonly decks: number;
  readonly notes: number;
  readonly cards: number;
  readonly reviews: number;
}

async function countRows(pool: Pool): Promise<Counts> {
  const result = await pool.query<{ table: string; n: number }>(
    `select 'decks' as table, count(*)::int as n from decks where user_id = $1
     union all select 'notes', count(*)::int from notes where user_id = $1
     union all select 'cards', count(*)::int from cards where user_id = $1
     union all select 'reviews', count(*)::int from reviews where user_id = $1`,
    [DEMO_USER_ID],
  );

  const counts: Record<string, number> = {};

  for (const row of result.rows) {
    counts[row.table] = row.n;
  }

  return counts as unknown as Counts;
}

describe.skipIf(!database)('the seed', () => {
  let owner: Pool;
  let repositories: Repositories;
  let first: Counts;

  beforeAll(async () => {
    if (!database) {
      return;
    }

    owner = rawOwnerPool(database);
    repositories = createRepositories(appClient(database), DEMO_USER_ID);

    await runSeed({ ownerUrl: database.ownerUrl, appUrl: database.appUrl, quiet: true });
    first = await countRows(owner);
  });

  afterAll(async () => {
    await owner?.end();
  });

  it('writes a collection worth looking at', () => {
    expect(first.decks).toBeGreaterThanOrEqual(7);
    expect(first.notes).toBeGreaterThan(100);
    expect(first.cards).toBeGreaterThan(100);
    expect(first.reviews).toBeGreaterThan(300);
  });

  it('puts cards in every state, so there is something to look at in each', async () => {
    const result = await owner.query<{ state: string; n: number }>(
      'select state, count(*)::int as n from cards where user_id = $1 group by state',
      [DEMO_USER_ID],
    );

    const states = new Set(result.rows.map((row) => row.state));

    expect([...states].sort()).toEqual(['learning', 'new', 'relearning', 'review']);
  });

  it('keeps non-ASCII content intact through the round trip', async () => {
    const result = await owner.query<{ fields: { translation?: string } }>(
      `select fields from notes
       where user_id = $1 and fields->>'term' = 'threshold' limit 1`,
      [DEMO_USER_ID],
    );

    expect(result.rows[0]?.fields.translation).toBe('порог');
  });

  it('leaves the same collection when it runs again', async () => {
    await runSeed({
      ownerUrl: database?.ownerUrl ?? '',
      appUrl: database?.appUrl ?? '',
      quiet: true,
    });

    const second = await countRows(owner);

    expect(second).toEqual(first);
  });

  it('gives every seeded row the same id on a second run', async () => {
    const result = await owner.query<{ id: string }>(
      'select id from decks where user_id = $1 order by name',
      [DEMO_USER_ID],
    );

    // Ids are derived from what the row is rather than generated, so a rerun
    // produces the same collection down to the identifiers.
    expect(result.rows).toHaveLength(first.decks);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(first.decks);
  });

  it('wrote card states that its own review log reproduces', async () => {
    const sample = await owner.query<{ id: string }>(
      `select c.id from cards c
        where c.user_id = $1 and c.state <> 'new'
        order by c.id limit 25`,
      [DEMO_USER_ID],
    );

    expect(sample.rows.length).toBeGreaterThan(0);

    const config = createSchedulerConfig({ timezone: 'Europe/Moscow', dayCutoffHour: 4 });

    for (const row of sample.rows) {
      const logs = await repositories.reviews.forCard(row.id);
      const card = await repositories.cards.byId(row.id);

      expect(card).toBeDefined();
      expect(logs.length).toBeGreaterThan(0);

      const rebuilt = replay(logs, config);

      // The seed never wrote a stability it made up: it answered the card and
      // kept what came out. So the log has to reproduce the row exactly, and if
      // a column ever starts rounding, this is where it shows.
      expect(rebuilt).toEqual(toSchedulingState(card!));
    }
  });
});
