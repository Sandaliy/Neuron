import { sql } from 'drizzle-orm';

import { contentQualityPageSchema } from '@neuron/shared';
import type { ContentCheck, ContentQualityQuery } from '@neuron/shared';

import type { Runner } from './session.js';

/** One statement gives counts and a bounded Note page the same visibility and snapshot. */
export function contentQualityRepository(userId: string, run: Runner) {
  return {
    inspect(query: ContentQualityQuery) {
      return run(async (tx) => {
        const pattern = `%${(query.search ?? '').replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
        const checks: Record<ContentCheck, ReturnType<typeof sql>> = {
          'translation-without-example': sql`not has_example and has_translation`,
          'example-without-translation': sql`has_example and not has_translation`,
          'missing-example': sql`not has_example`,
          'missing-definition': sql`not has_definition`,
        };
        // JavaScript trim's whitespace set, explicitly shared by the SQL presence checks.
        const whitespace =
          ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
        const present = (field: string) => sql`(
          jsonb_typeof(n.fields -> ${field}) = 'string'
          and length(btrim(n.fields ->> ${field}, ${whitespace})) > 0
        ) is true`;
        const result = await tx.execute(sql`
          with recursive live_collections(id, kind, location, depth) as (
            select id, kind, array[name]::text[], 0 from decks
            where user_id = ${userId} and parent_id is null
              and deleted_at is null and purged_at is null
            union all
            select child.id, child.kind, parent.location || child.name, parent.depth + 1
            from decks child join live_collections parent on child.parent_id = parent.id
            where child.user_id = ${userId} and parent.kind = 'folder' and parent.depth < 8
              and child.deleted_at is null and child.purged_at is null
          ), candidates as materialized (
            select n.id, c.location,
              ${present('example')} as has_example,
              ${present('exampleTranslation')} as has_translation,
              ${present('definition')} as has_definition
            from notes n join live_collections c on c.id = n.deck_id and c.kind = 'deck'
            join note_types nt on nt.id = n.note_type_id and nt.name = 'vocab'
              and (nt.user_id is null or nt.user_id = ${userId}) and nt.deleted_at is null
            where n.user_id = ${userId} and n.deleted_at is null and n.purged_at is null
              ${query.deckId === undefined ? sql`` : sql`and n.deck_id = ${query.deckId}::uuid`}
              ${
                query.search === undefined
                  ? sql``
                  : sql`and (
                concat_ws(chr(10), n.fields ->> 'term', n.fields ->> 'translation',
                  n.fields ->> 'reading', n.fields ->> 'definition', n.fields ->> 'example',
                  n.fields ->> 'exampleTranslation', n.fields ->> 'mnemonic', n.fields ->> 'note',
                  array_to_string(n.tags, ' '), n.source, array_to_string(c.location, ' / ')
                ) ilike ${pattern} escape chr(92)
              )`
              }
          ), summary as (
            select count(*)::int as vocabulary_count, jsonb_build_object(
              'translation-without-example', count(*) filter (where ${checks['translation-without-example']})::int,
              'example-without-translation', count(*) filter (where ${checks['example-without-translation']})::int,
              'missing-example', count(*) filter (where ${checks['missing-example']})::int,
              'missing-definition', count(*) filter (where ${checks['missing-definition']})::int
            ) as counts from candidates
          ), page as (
            select id, location from candidates
            where ${query.category === undefined ? sql`false` : checks[query.category]}
              ${query.cursor === undefined ? sql`` : sql`and id > ${query.cursor}::uuid`}
            order by id limit ${query.limit + 1}
          )
          select summary.*, coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', n.id, 'deckId', n.deck_id, 'noteType', 'vocab', 'fields', n.fields,
              'tags', n.tags, 'source', n.source, 'rank', n.rank, 'status', n.status,
              'triage', n.triage, 'importBatchId', n.import_batch_id,
              'createdAt', n.created_at, 'updatedAt', n.updated_at, 'rev', n.rev,
              'deckPath', page.location
            ) order by n.id) from page join notes n on n.id = page.id
              and n.user_id = ${userId} and n.deleted_at is null and n.purged_at is null
          ), '[]'::jsonb) as items from summary
        `);
        const row = result.rows[0]!;
        const items = row['items'] as { id: string }[];
        return contentQualityPageSchema.parse({
          counts: row['counts'],
          vocabularyCount: row['vocabulary_count'],
          items: items.slice(0, query.limit),
          ...(items.length > query.limit ? { nextCursor: items[query.limit - 1]!.id } : {}),
        });
      });
    },
  };
}
