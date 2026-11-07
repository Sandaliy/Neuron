import { describe, expect, it } from 'vitest';

import { testServer } from '../../testing/server.js';
import { createUser, rawOwnerPool, repositoriesFor, testDatabase } from '../testing/database.js';

/**
 * Progression at the size of a real imported list.
 *
 * Planning runs the sweep on every Study plan, so the case that matters most is
 * the one where it has nothing to do. The catch-up case is the first plan of a
 * learner who answered thousands of words before progression existed.
 */

const database = testDatabase();
const NOTES = 25_000;
/**
 * The end-to-end plan is smaller. Planning itself (the forecast over every
 * answered Card) costs seconds per thousand young Cards on main already, and
 * does not fit a test worker's memory at 25,000; that predates progression and
 * is recorded in docs/STATE.md. What this measures is what the sweep adds.
 */
const PLANNED = 500;

async function seed(owner: string, eligibleEvery: number, size = NOTES): Promise<string[]> {
  const pool = rawOwnerPool(database!);
  try {
    await pool.query(
      `insert into decks (id, user_id, name, position) select gen_random_uuid(), $1, 'Deck ' || n, n from generate_series(1,10) n`,
      [owner],
    );
    await pool.query(
      `with destinations as (select array_agg(id order by position) ids from decks where user_id = $1)
       insert into notes (id, user_id, deck_id, note_type_id, fields, created_at, updated_at)
       select gen_random_uuid(), $1, ids[1 + n % 10],
         (select id from note_types where name = 'vocab' and user_id is null),
         jsonb_build_object('term', 'Wort ' || n, 'translation', 'word ' || n, 'seq', n),
         now(), now()
       from generate_series(1, ${size}) n cross join destinations`,
      [owner],
    );
    // Every Note has recognition. Most are young or new; every `eligibleEvery`th
    // already holds 30 days and has no recall yet. Mature Notes beyond that
    // already have recall, below its own threshold, so they owe nothing.
    await pool.query(
      `insert into cards (id, user_id, note_id, deck_id, direction, slot, state, stability, difficulty,
         due, last_review, reps, lapses, unlock_reason, rev)
       select gen_random_uuid(), $1, n.id, n.deck_id, 'recognition', 0,
         case when s.stability is null then 'new' else 'review' end,
         s.stability, case when s.stability is null then null else 5 end,
         now() + interval '1 day', case when s.stability is null then null else now() - interval '3 days' end,
         case when s.stability is null then 0 else 3 end, 0, 'opening', 1
       from notes n
       cross join lateral (select case
         when (n.fields->>'seq')::int % $2 = 0 then 30.0
         when (n.fields->>'seq')::int % 5 = 0 then null
         when (n.fields->>'seq')::int % 7 = 0 then 60.0
         else 1 + ((n.fields->>'seq')::int % 12) end as stability) s
       where n.user_id = $1`,
      [owner, eligibleEvery],
    );
    await pool.query(
      `insert into cards (id, user_id, note_id, deck_id, direction, slot, state, stability, difficulty,
         due, last_review, reps, lapses, unlock_reason, rev)
       select gen_random_uuid(), $1, c.note_id, c.deck_id, 'recall', 0, 'review', 9, 5,
         now() + interval '2 days', now() - interval '2 days', 2, 0, 'ladder', 1
       from cards c where c.user_id = $1 and c.direction = 'recognition' and c.stability = 60`,
      [owner],
    );
    await pool.query('analyze cards');
    await pool.query('analyze notes');
    const decks = await pool.query<{ id: string }>(`select id from decks where user_id = $1`, [
      owner,
    ]);
    return decks.rows.map((row) => row.id);
  } finally {
    await pool.end();
  }
}

describe.skipIf(!database)('progression at scale', () => {
  it(`finds nothing to do across ${NOTES} Notes quickly`, async () => {
    const owner = 'progression-scale-idle';
    await createUser(database!, owner);
    // eligibleEvery larger than the list: nobody qualifies.
    const deckIds = await seed(owner, NOTES * 10);
    const repositories = repositoriesFor(database!, owner);
    const rev = (await repositories.account.read()).currentRev;
    await repositories.cards.sweepProgression(deckIds, new Date()); // warm
    const samples: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      expect(await repositories.cards.sweepProgression(deckIds, new Date())).toEqual([]);
      samples.push(performance.now() - started);
    }
    expect((await repositories.account.read()).currentRev).toBe(rev);
    const median = samples.sort((a, b) => a - b)[1]!;
    console.info(
      `Progression sweep, nothing to do, ${NOTES} Notes: median ${median.toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(2_000);
  }, 120_000);

  it(`opens what ${NOTES / 5} of ${NOTES} Notes owe in one sweep, exactly once`, async () => {
    const owner = 'progression-scale-sweep';
    await createUser(database!, owner);
    const deckIds = await seed(owner, 5);
    const repositories = repositoriesFor(database!, owner);
    const started = performance.now();
    const opened = await repositories.cards.sweepProgression(deckIds, new Date());
    const elapsed = performance.now() - started;
    expect(opened).toHaveLength(NOTES / 5);
    expect(new Set(opened.map((card) => card.noteId)).size).toBe(NOTES / 5);
    expect(opened.every((card) => card.direction === 'recall' && card.state === 'new')).toBe(true);
    const idleStarted = performance.now();
    expect(await repositories.cards.sweepProgression(deckIds, new Date())).toEqual([]);
    console.info(
      `Progression sweep opening ${NOTES / 5} of ${NOTES}: ${elapsed.toFixed(0)} ms; next ${(performance.now() - idleStarted).toFixed(0)} ms`,
    );
    expect(elapsed).toBeLessThan(30_000);
  }, 180_000);

  it('catches up an existing learner once, inside the plan, without duplicates', async () => {
    const owner = 'progression-scale-catchup';
    await createUser(database!, owner);
    const deckIds = await seed(owner, 5, PLANNED);
    const repositories = repositoriesFor(database!, owner);
    const server = testServer(database!, owner);

    const started = performance.now();
    const response = await server.request('/api/study/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deckIds }),
    });
    const firstPlan = performance.now() - started;
    expect(response.status).toBe(200);
    const plan = (await response.json()) as { newCount: number; newCards: { allowed: number } };
    expect(plan.newCount).toBeLessThanOrEqual(plan.newCards.allowed);

    const pool = rawOwnerPool(database!);
    try {
      const counts = await pool.query<{ ladder: string; duplicates: string }>(
        `select
           (select count(*) from cards where user_id = $1 and direction = 'recall'
              and unlock_reason = 'ladder' and unlocked_by_review_id is null and state = 'new') ladder,
           (select count(*) from (select note_id from cards where user_id = $1 and deleted_at is null
              group by note_id, direction, slot having count(*) > 1) d) duplicates`,
        [owner],
      );
      // seq % 5 = 0 held 30 days: one recall each, nothing for anyone else.
      expect(Number(counts.rows[0]!.ladder)).toBe(PLANNED / 5);
      expect(Number(counts.rows[0]!.duplicates)).toBe(0);
    } finally {
      await pool.end();
    }

    const again = performance.now();
    const second = await server.request('/api/study/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deckIds }),
    });
    const nextPlan = performance.now() - again;
    expect(second.status).toBe(200);
    expect(await repositories.cards.sweepProgression(deckIds, new Date())).toEqual([]);
    console.info(
      `Progression catch-up: first plan of ${PLANNED} Notes opening ${PLANNED / 5}: ${firstPlan.toFixed(0)} ms; next plan ${nextPlan.toFixed(0)} ms`,
    );
    // What the catch-up adds to the plan it runs in.
    expect(firstPlan - nextPlan).toBeLessThan(10_000);
  }, 180_000);
});
