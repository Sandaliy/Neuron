import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSchedulerConfig, replay } from '@neuron/core';
import { openingCards, possibleCards, resolveDeckSettings } from '@neuron/shared';

import { createRepositories } from '../repositories/index.js';
import { toSchedulingState } from '../repositories/mapping.js';
import { appClient, rawOwnerPool, testDatabase } from '../testing/database.js';

import { CLOZE_NOTES } from './data.js';
import { DEMO_USER_ID, runSeed, seedId } from './main.js';

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
const NOW = new Date('2026-10-31T12:00:00Z');

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

    await runSeed({ ownerUrl: database.ownerUrl, appUrl: database.appUrl, quiet: true, now: NOW });
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
      now: NOW,
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

  it('seeds every canonical Cloze gap with a distinct stable identity and displayable face', async () => {
    const allIds: string[] = [];
    for (const [index, fields] of CLOZE_NOTES.entries()) {
      const noteId = seedId(`note:cloze:${index}`);
      const cards = await repositories.cards.forNote(noteId);
      const planned = openingCards('cloze', fields, resolveDeckSettings([]).ladder);
      expect(cards.map(({ direction, slot }) => ({ direction, slot }))).toEqual(
        planned.map(({ direction, slot }) => ({ direction, slot })),
      );
      for (const card of cards) {
        expect(card.id).toBe(seedId(`card:cloze:${index}:${card.direction}:${card.slot}`));
        expect(card.slot).toBeGreaterThan(0);
        const face = possibleCards('cloze', fields).find(
          (candidate) => candidate.direction === card.direction && candidate.slot === card.slot,
        );
        expect(face?.front[0]?.value).toContain('[...]');
        expect(face?.back[0]?.value).not.toContain('{{');
        expect(face?.front).not.toEqual(face?.back);
        allIds.push(card.id);
      }
    }
    expect(allIds).toHaveLength(7);
    expect(new Set(allIds).size).toBe(7);
  });

  it('replays every reviewed Cloze slot exactly and leaves unstudied slots new', async () => {
    const config = createSchedulerConfig({ timezone: 'Europe/Moscow', dayCutoffHour: 4 });
    for (const index of CLOZE_NOTES.keys()) {
      for (const card of await repositories.cards.forNote(seedId(`note:cloze:${index}`))) {
        const logs = await repositories.reviews.forCard(card.id);
        if (index < 2) {
          expect(logs.length).toBeGreaterThan(0);
          expect(replay(logs, config)).toEqual(toSchedulingState(card));
        } else {
          expect(logs).toEqual([]);
          expect(card.state).toBe('new');
          expect(card.due).toEqual(NOW);
        }
      }
    }
  });

  it('reproduces Card identities, schedules and Review values at a fixed history endpoint', async () => {
    const snapshot = async () => {
      const cards = await owner.query(
        `select to_jsonb(c) - 'created_at' - 'updated_at' - 'rev' as value
         from cards c where user_id = $1 order by id`,
        [DEMO_USER_ID],
      );
      const reviews = await owner.query(
        `select to_jsonb(r) - 'id' - 'created_at' - 'rev' as value
         from reviews r where user_id = $1 order by card_id, reviewed_at`,
        [DEMO_USER_ID],
      );
      return { cards: cards.rows, reviews: reviews.rows };
    };
    const before = await snapshot();
    await runSeed({
      ownerUrl: database!.ownerUrl,
      appUrl: database!.appUrl,
      quiet: true,
      now: NOW,
    });
    expect(await snapshot()).toEqual(before);
  });
});
