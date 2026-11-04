import { sql } from 'drizzle-orm';

import {
  possibleDuplicateGroupsPageSchema,
  possibleDuplicateNotesPageSchema,
} from '@neuron/shared';
import type { PossibleDuplicateGroupsQuery, PossibleDuplicateNotesQuery } from '@neuron/shared';

import type { Runner } from './session.js';

/** Read-only inspection. The generated term_key and its existing account index own equality. */
export function possibleDuplicateRepository(userId: string, run: Runner) {
  // Parent links, rather than cached paths, exclude orphaned, cyclic, foreign and
  // deleted ancestry. Only Folders may contain children and only Decks own Notes.
  const visible = (deckId?: string, key?: string) => sql`
    with recursive live_collections(id, kind, location, depth) as (
      select id, kind, array[name]::text[], 0 from decks
      where user_id = ${userId} and parent_id is null
        and deleted_at is null and purged_at is null
      union all
      select child.id, child.kind, parent.location || child.name, parent.depth + 1
      from decks child join live_collections parent on child.parent_id = parent.id
      where child.user_id = ${userId} and parent.kind = 'folder' and parent.depth < 8
        and child.deleted_at is null and child.purged_at is null
    ), visible as (
      select n.*, c.location, nt.name as type_name
      from notes n join live_collections c on c.id = n.deck_id and c.kind = 'deck'
      join note_types nt on nt.id = n.note_type_id
        and (nt.user_id is null or nt.user_id = ${userId}) and nt.deleted_at is null
      where n.user_id = ${userId} and n.deleted_at is null and n.purged_at is null
        and n.term_key <> ''
        ${deckId === undefined ? sql`` : sql`and n.deck_id = ${deckId}::uuid`}
        ${key === undefined ? sql`` : sql`and n.term_key = ${key}`}
    )`;
  return {
    groups(query: PossibleDuplicateGroupsQuery) {
      return run(async (tx) => {
        const pattern = `%${(query.search ?? '').replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
        const result = await tx.execute(sql`
          ${visible(query.deckId)}
          select term_key as key, count(*)::int as count from visible
          ${query.cursor === undefined ? sql`` : sql`where term_key collate "C" > ${query.cursor} collate "C"`}
          group by term_key
          having count(*) >= 2
            ${
              query.search === undefined
                ? sql``
                : sql`and bool_or(
              term_key ilike ${pattern} escape chr(92)
              or fields::text ilike ${pattern} escape chr(92)
              or coalesce(source, '') ilike ${pattern} escape chr(92)
              or array_to_string(location, ' / ') ilike ${pattern} escape chr(92)
            )`
            }
          order by term_key collate "C" limit ${query.limit + 1}
        `);
        const items = result.rows.slice(0, query.limit);
        return possibleDuplicateGroupsPageSchema.parse({
          items,
          ...(result.rows.length > query.limit ? { nextCursor: items.at(-1)?.['key'] } : {}),
        });
      });
    },
    notes(query: PossibleDuplicateNotesQuery) {
      return run(async (tx) => {
        const result = await tx.execute(sql`
          ${visible(query.deckId, query.key)}
          select jsonb_build_object(
            'id', id, 'deckId', deck_id, 'noteType', type_name, 'fields', fields,
            'tags', tags, 'source', source, 'rank', rank, 'status', status, 'triage', triage,
            'importBatchId', import_batch_id, 'createdAt', created_at, 'updatedAt', updated_at,
            'rev', rev, 'deckPath', location
          ) as note from visible
          where (select count(*) from visible) >= 2
            ${query.cursor === undefined ? sql`` : sql`and id > ${query.cursor}::uuid`}
          order by id limit ${query.limit + 1}
        `);
        const items = result.rows.slice(0, query.limit).map((row) => row['note']);
        return possibleDuplicateNotesPageSchema.parse({
          items,
          ...(result.rows.length > query.limit
            ? { nextCursor: (items.at(-1) as { id: string }).id }
            : {}),
        });
      });
    },
  };
}
