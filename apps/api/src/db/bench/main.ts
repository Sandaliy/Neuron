import process from 'node:process';

import { describeConnection, requireUrl, withPool } from '../tooling.js';

import type { Pool } from '@neondatabase/serverless';

/**
 * Measures the query the application runs on every open, in both of the shapes
 * it could have.
 *
 * A card reaches its deck through its note, so "what is due in this folder"
 * joins two tables. The alternative is to copy `deck_id` onto the card, which
 * makes one index answer the whole question but creates a second place where
 * the same fact lives, and moving a note then has to update both.
 *
 * The point of this script is that the choice is made with numbers rather than
 * with an opinion. It builds fifty thousand cards for a throwaway user, runs
 * both shapes, prints the plans, and removes everything it made.
 */

const BENCH_USER_ID = 'bench-user';
const DECK_COUNT = 200;
const CARD_COUNT = 50_000;
const RUNS = 5;

interface Measurement {
  readonly label: string;
  readonly plan: string;
  readonly timings: readonly number[];
}

/** The middle timing, which is less swayed by one slow run than the mean is. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/**
 * Runs a query under EXPLAIN a few times and keeps the plan and the timings.
 *
 * The first run is thrown away, because it pays for reading pages that every
 * later run finds in memory, and the question here is what a warm application
 * sees.
 *
 * @param pool the connection
 * @param label what is being measured
 * @param sql the query
 * @param params its parameters
 * @returns the plan and the timings
 */
async function measure(
  pool: Pool,
  label: string,
  sql: string,
  params: readonly unknown[],
): Promise<Measurement> {
  const timings: number[] = [];
  let plan = '';

  for (let run = 0; run <= RUNS; run += 1) {
    const result = await pool.query<{ 'QUERY PLAN': string }>(
      `explain (analyze, buffers, format text) ${sql}`,
      [...params],
    );

    const text = result.rows.map((row) => row['QUERY PLAN']).join('\n');
    const match = /Execution Time: ([\d.]+) ms/.exec(text);

    if (run === 0) {
      plan = text;
      continue;
    }

    timings.push(Number(match?.[1] ?? 0));
  }

  return { label, plan, timings };
}

/**
 * Builds a collection large enough for the plans to mean something.
 *
 * Written with generate_series rather than through the repositories: this is a
 * fixture, and fifty thousand rows through the application path would take
 * minutes and measure the wrong thing.
 *
 * @param pool the owner connection
 */
async function buildFixture(pool: Pool): Promise<void> {
  await pool.query('select set_config($1, $2, true)', ['app.erasing_account', 'on']);
  await pool.query('delete from "user" where id = $1', [BENCH_USER_ID]);
  await pool.query('insert into "user" (id, name, email) values ($1, $1, $2)', [
    BENCH_USER_ID,
    'bench@neuron.local',
  ]);

  // Ten folders, each holding nineteen decks. Close to what a person with
  // several languages and a few courses ends up with.
  await pool.query(
    `insert into decks (id, user_id, name, parent_id, path, position)
     select gen_random_uuid(), $1, 'Folder ' || n, null, '{}'::uuid[], n
     from generate_series(1, 10) as n`,
    [BENCH_USER_ID],
  );

  await pool.query(
    `with roots as (select id, row_number() over (order by position) as n from decks where user_id = $1)
     insert into decks (id, user_id, name, parent_id, path, position)
     select gen_random_uuid(), $1, 'Deck ' || s, roots.id, array[roots.id], s
     from generate_series(1, $2) as s
     join roots on roots.n = 1 + (s % 10)`,
    [BENCH_USER_ID, DECK_COUNT - 10],
  );

  await pool.query(
    `with leaves as (
       select id, row_number() over (order by id) - 1 as n
       from decks where user_id = $1 and parent_id is not null
     ),
     vocab as (select id from note_types where name = 'vocab' limit 1)
     insert into notes (id, user_id, deck_id, note_type_id, fields, rank, rev)
     select
       gen_random_uuid(),
       $1,
       leaves.id,
       vocab.id,
       jsonb_build_object('term', 'word ' || s, 'translation', 'meaning ' || s),
       s,
       1
     from generate_series(1, $2) as s
     join leaves on leaves.n = s % (select count(*) from leaves)
     cross join vocab`,
    [BENCH_USER_ID, CARD_COUNT],
  );

  // Due dates spread over four months, so roughly half the collection is due
  // and the index has to actually narrow something down.
  await pool.query(
    `insert into cards (id, user_id, note_id, deck_id, direction, state, stability, difficulty, due, last_review, reps, lapses, rev)
     select
       gen_random_uuid(),
       $1,
       notes.id,
       notes.deck_id,
       'recognition',
       'review',
       1 + (random() * 200),
       1 + (random() * 9),
       now() + ((random() * 120 - 60) || ' days')::interval,
       now() - '10 days'::interval,
       3,
       0,
       1
     from notes where user_id = $1`,
    [BENCH_USER_ID],
  );

  await pool.query('analyze decks, notes, cards');
}

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'The benchmark writes fifty thousand throwaway rows and removes them afterwards.',
  );

  console.log(`measuring ${describeConnection(ownerUrl)}`);

  await withPool(ownerUrl, async (pool) => {
    try {
      console.log(`building ${CARD_COUNT} cards across ${DECK_COUNT} decks`);
      await buildFixture(pool);

      const [folder] = (
        await pool.query<{ id: string }>(
          'select id from decks where user_id = $1 and parent_id is null order by position limit 1',
          [BENCH_USER_ID],
        )
      ).rows;

      const subtree = `(select id from decks where user_id = $1 and deleted_at is null
                        and (id = $2 or path @> array[$2]::uuid[]))`;

      const measurements = [
        await measure(
          pool,
          'Q1a  due in a folder, joined through notes',
          `select c.* from cards c
             join notes n on n.id = c.note_id
            where c.user_id = $1 and c.deleted_at is null and c.due <= now()
              and n.deleted_at is null and n.deck_id in ${subtree}
            order by c.due limit 200`,
          [BENCH_USER_ID, folder?.id],
        ),
        await measure(
          pool,
          'Q1b  due in a folder, deck on the card, as shipped',
          `select c.* from cards c
            where c.user_id = $1 and c.deleted_at is null and c.due <= now()
              and c.deck_id in ${subtree}
            order by c.due limit 200`,
          [BENCH_USER_ID, folder?.id],
        ),
        await measure(
          pool,
          'Q2   due across the whole collection',
          `select * from cards
            where user_id = $1 and deleted_at is null and due <= now()
            order by due limit 200`,
          [BENCH_USER_ID],
        ),
        await measure(
          pool,
          'Q3a  counts per deck for the library tree, joined through notes',
          `select n.deck_id, count(*)::int
             from cards c join notes n on n.id = c.note_id
            where c.user_id = $1 and c.deleted_at is null and n.deleted_at is null
            group by n.deck_id`,
          [BENCH_USER_ID],
        ),
        await measure(
          pool,
          'Q3b  counts per deck, deck on the card, as shipped',
          `select deck_id, count(*)::int from cards
            where user_id = $1 and deleted_at is null
            group by deck_id`,
          [BENCH_USER_ID],
        ),
        await measure(
          pool,
          'Q4   everything changed since a revision',
          `select id, rev from cards where user_id = $1 and rev > $2 order by rev limit 500`,
          [BENCH_USER_ID, 0],
        ),
      ];

      console.log('');

      for (const item of measurements) {
        const scans = item.plan
          .split('\n')
          .filter((line) => /Scan/.test(line))
          .map((line) => line.trim().split(' on ')[0]?.trim())
          .join(' | ');

        console.log(`${item.label}`);
        console.log(
          `  median ${median(item.timings).toFixed(2)} ms   runs ${item.timings.map((value) => value.toFixed(1)).join(', ')}`,
        );
        console.log(`  ${scans}`);
        console.log('');
      }

      console.log('--- full plans ---');

      for (const item of measurements) {
        console.log(`\n${item.label}\n${item.plan}`);
      }
    } finally {
      if (!process.argv.includes('--keep')) {
        await pool.query('select set_config($1, $2, true)', ['app.erasing_account', 'on']);
        await pool.query('delete from "user" where id = $1', [BENCH_USER_ID]);
        console.log('\nfixture removed');
      }
    }
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
