import { sql } from 'drizzle-orm';

import {
  PROBLEM_CARD_MINIMUM_ANSWERS,
  PROBLEM_CARD_POLICY,
  problemCardCursor,
  problemCardsPageSchema,
  readProblemCardCursor,
} from '@neuron/shared';
import type { ProblemCardsPage, ProblemCardsQuery } from '@neuron/shared';

import type { Runner } from './session.js';

const iso = (value: unknown) => (value === null ? null : new Date(String(value)).toISOString());

/**
 * Read-only Slipping Cards. One bounded SELECT inside the account transaction.
 *
 * Evidence is each Card's current learning history, the same set of answers the scheduler
 * replays (`logFor` in reviews.ts): not a cancellation event, not an answer that was undone,
 * nothing before the latest restart event (ordered by reviewed_at, rev, id), nothing before
 * an explicit reset. The Card's own `reps` projection can never be smaller than that count,
 * so it pre-filters Cards before any Review is read. Only active Notes in live, account-owned
 * Decks reached through actual parent links contribute.
 */
export function problemCardRepository(userId: string, run: Runner) {
  return {
    list(query: ProblemCardsQuery): Promise<ProblemCardsPage> {
      return run(async (tx) => {
        const cursor =
          query.cursor === undefined ? undefined : readProblemCardCursor(query.sort, query.cursor);
        const pattern =
          query.search === undefined
            ? undefined
            : `%${query.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
        const after =
          cursor === undefined
            ? sql``
            : query.sort === 'again'
              ? sql`where (again, last_again_at, id) < (${cursor.again ?? 0}::int, ${cursor.lastAgainAt}::timestamptz, ${cursor.id}::uuid)`
              : sql`where (last_again_at, id) < (${cursor.lastAgainAt}::timestamptz, ${cursor.id}::uuid)`;
        const order =
          query.sort === 'again'
            ? sql`order by again desc, last_again_at desc, id desc`
            : sql`order by last_again_at desc, id desc`;
        /** The answers the scheduler replays: see `logFor` in reviews.ts. */
        const countedAs = (review: string, card: string, carried = false) => {
          const r = sql.raw(review);
          const c = sql.raw(card);
          const restart = carried
            ? sql`(${c}.restart_id is null or (${r}.reviewed_at, ${r}.rev, ${r}.id) > (${c}.restart_at, ${c}.restart_rev, ${c}.restart_id))`
            : sql`(s.card_id is null or (${r}.reviewed_at, ${r}.rev, ${r}.id) > (s.reviewed_at, s.rev, s.id))`;
          return sql`${r}.cancels_review_id is null and not ${r}.resets_learning
            and ${r}.id not in (select id from cancelled)
            and (${c}.reset_at is null or ${r}.reviewed_at >= ${c}.reset_at)
            and ${restart}`;
        };
        const counted = countedAs('r', 'c');
        const result = await tx.execute(sql`
          with recursive live_collections(id, kind, location, ancestors, depth) as (
            select id, kind, array[name]::text[], array[id]::uuid[], 0 from decks
            where user_id = ${userId} and parent_id is null
              and deleted_at is null and purged_at is null
            union all
            select child.id, child.kind, parent.location || child.name,
              parent.ancestors || child.id, parent.depth + 1
            from decks child join live_collections parent on child.parent_id = parent.id
            where child.user_id = ${userId} and parent.kind = 'folder' and parent.depth < 8
              and child.deleted_at is null and child.purged_at is null
          ), candidates as materialized (
            select c.id, c.note_id, c.deck_id, c.direction, c.slot, c.state, c.due,
              c.suspended_at, c.reset_at, c.rev, n.fields, n.source, nt.name as type_name,
              lc.location
            from cards c
            join notes n on n.id = c.note_id and n.user_id = ${userId}
              and n.deck_id = c.deck_id and n.status = 'active'
              and n.deleted_at is null and n.purged_at is null
            join note_types nt on nt.id = n.note_type_id
              and (nt.user_id is null or nt.user_id = ${userId}) and nt.deleted_at is null
            join live_collections lc on lc.id = c.deck_id and lc.kind = 'deck'
            where c.user_id = ${userId} and c.deleted_at is null and c.purged_at is null
              and c.reps >= ${PROBLEM_CARD_MINIMUM_ANSWERS}
              ${query.deckId === undefined ? sql`` : sql`and ${query.deckId}::uuid = any(lc.ancestors)`}
              ${query.direction === undefined ? sql`` : sql`and c.direction = ${query.direction}`}
              ${query.state === 'studying' ? sql`and c.suspended_at is null` : sql``}
              ${query.state === 'suspended' ? sql`and c.suspended_at is not null` : sql``}
              ${
                pattern === undefined
                  ? sql``
                  : sql`and (n.fields::text ilike ${pattern} escape chr(92)
                    or coalesce(n.source, '') ilike ${pattern} escape chr(92)
                    or array_to_string(lc.location, ' / ') ilike ${pattern} escape chr(92))`
              }
          ), cancelled as (
            -- Undo is rare, so the account's cancellation targets form a small hashed set.
            select cancels_review_id as id from reviews
            where user_id = ${userId} and cancels_review_id is not null
          ), restarts as (
            -- Restart events carry a restart id, so the account's few of them come straight from
            -- the (user_id, restart_id, card_id) unique index rather than from every answer.
            select distinct on (card_id) card_id, reviewed_at, rev, id from reviews
            where user_id = ${userId} and restart_id is not null and resets_learning
            order by card_id, reviewed_at desc, rev desc, id desc
          ), listed as (
            -- Phase one decides membership with plain counts, one index range per candidate.
            select c.*, e.answers, e.again, e.lapses, e.last_again_at, e.last_answered_at,
              s.reviewed_at as restart_at, s.rev as restart_rev, s.id as restart_id,
              nullif(greatest(coalesce(c.reset_at, '-infinity'), coalesce(s.reviewed_at, '-infinity')), '-infinity') as started_at,
              to_char(e.last_again_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as again_key
            from candidates c
            left join restarts s on s.card_id = c.id
            cross join lateral (
              select count(*)::int as answers,
                count(*) filter (where r.rating = 'again')::int as again,
                count(*) filter (where r.rating = 'again' and r.state_before = 'review')::int as lapses,
                max(r.reviewed_at) filter (where r.rating = 'again') as last_again_at,
                max(r.reviewed_at) as last_answered_at
              from reviews r
              where r.user_id = ${userId} and r.card_id = c.id and ${counted}
            ) e
            where e.lapses >= ${PROBLEM_CARD_POLICY.repeatedLapses}
              or (e.again >= ${PROBLEM_CARD_POLICY.frequentAgain}
                and e.again >= e.answers * ${PROBLEM_CARD_POLICY.frequentAgainShare}::float8)
          ), page as (
            select * from listed ${after} ${order} limit ${query.limit + 1}
          )
          -- Phase two explains only the Cards on this page. The total stays known on a page
          -- past the end, so it is joined rather than repeated.
          select page.*, totals.total, explained.recent, explained.since_last_again
          from (select count(*)::int as total from listed) totals
          left join page on true
          left join lateral (
            select
              count(*) filter (where r.reviewed_at > page.last_again_at)::int as since_last_again,
              (select jsonb_agg(jsonb_build_object(
                  'rating', latest.rating, 'reviewedAt', latest.reviewed_at,
                  'stateBefore', latest.state_before
                ) order by latest.reviewed_at desc, latest.rev desc, latest.id desc)
                from (
                  select r2.rating, r2.reviewed_at, r2.state_before, r2.rev, r2.id
                  from reviews r2
                  where r2.user_id = ${userId} and r2.card_id = page.id
                    and ${countedAs('r2', 'page', true)}
                  order by r2.reviewed_at desc, r2.rev desc, r2.id desc
                  limit ${PROBLEM_CARD_POLICY.recentAnswers}
                ) latest) as recent
            from reviews r
            where r.user_id = ${userId} and r.card_id = page.id and ${countedAs('r', 'page', true)}
          ) explained on page.id is not null
          ${order}
        `);
        const all = result.rows as Record<string, unknown>[];
        const rows = all.filter((row) => row['id'] !== null);
        const items = rows.slice(0, query.limit).map((row) => {
          const answers = Number(row['answers']);
          const again = Number(row['again']);
          const lapses = Number(row['lapses']);
          return {
            card: {
              id: row['id'],
              noteId: row['note_id'],
              deckId: row['deck_id'],
              direction: row['direction'],
              slot: Number(row['slot']),
              state: row['state'],
              due: iso(row['due']),
              suspendedAt: iso(row['suspended_at']),
              rev: Number(row['rev']),
            },
            note: {
              id: row['note_id'],
              deckId: row['deck_id'],
              noteType: row['type_name'],
              fields: row['fields'],
              source: row['source'] ?? null,
            },
            deckPath: row['location'],
            reasons: [
              ...(lapses >= PROBLEM_CARD_POLICY.repeatedLapses ? ['repeated_lapses'] : []),
              ...(again >= PROBLEM_CARD_POLICY.frequentAgain &&
              again >= answers * PROBLEM_CARD_POLICY.frequentAgainShare
                ? ['frequent_again']
                : []),
            ],
            evidence: {
              kind: 'history',
              answers,
              again,
              lapses,
              lastAgainAt: iso(row['last_again_at']),
              lastAnsweredAt: iso(row['last_answered_at']),
              sinceLastAgain: Number(row['since_last_again']),
              startedAt: iso(row['started_at'] ?? null),
              recent: ((row['recent'] ?? []) as Record<string, unknown>[]).map((answer) => ({
                rating: answer['rating'],
                reviewedAt: iso(answer['reviewedAt']),
                stateBefore: answer['stateBefore'],
              })),
            },
            sortKey: { again, lastAgainAt: String(row['again_key']), id: String(row['id']) },
          };
        });
        const last = items.at(-1);
        return problemCardsPageSchema.parse({
          items: items.map(({ sortKey: _sortKey, ...item }) => item),
          total: Number(all[0]?.['total'] ?? 0),
          ...(rows.length > query.limit && last
            ? { nextCursor: problemCardCursor(query.sort, last.sortKey) }
            : {}),
        });
      });
    },
  };
}
