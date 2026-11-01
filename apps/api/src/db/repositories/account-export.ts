import { sql } from 'drizzle-orm';

import {
  EXPORT_ENTITIES,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  EXPORT_MAX_BYTES,
  EXPORT_MAX_LINE_BYTES,
  emptyExportCounts,
  noteFieldsSchemas,
  uuidV7,
} from '@neuron/shared';
import type { ExportEntity } from '@neuron/shared';

import { nameUser } from './session.js';

import type { Database } from '../client.js';

const owned = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'rev'];
const scheduling = [
  'state',
  'stability',
  'difficulty',
  'due',
  'lastReview',
  'placedDue',
  'reps',
  'lapses',
  'learningStep',
];

/** These are output allowlists, never SELECT * or whole-row serialization. */
export const EXPORT_TABLES = [
  {
    entity: 'preferences',
    table: 'user',
    columns: ['id', 'locale', 'theme', 'timezone', 'dayCutoffHour', 'settings', 'currentRev'],
  },
  {
    entity: 'noteTypes',
    table: 'note_types',
    columns: [
      'id',
      'name',
      'isSystem',
      'fieldSchema',
      'cardTemplates',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
  },
  {
    entity: 'decks',
    table: 'decks',
    columns: [
      ...owned,
      'kind',
      'parentId',
      'name',
      'position',
      'path',
      'settings',
      'deletionId',
      'purgedAt',
    ],
  },
  {
    entity: 'importBatches',
    table: 'import_batches',
    columns: [...owned, 'deckId', 'source', 'format', 'noteCount', 'undoneAt'],
  },
  {
    entity: 'notes',
    table: 'notes',
    columns: [
      ...owned,
      'deckId',
      'noteTypeId',
      'fields',
      'tags',
      'source',
      'rank',
      'status',
      'importBatchId',
      'purgedAt',
    ],
  },
  {
    entity: 'cards',
    table: 'cards',
    columns: [
      ...owned,
      'noteId',
      'deckId',
      'direction',
      'slot',
      ...scheduling,
      'unlockedAt',
      'suspendedAt',
      'resetAt',
      'deletedWithNote',
      'purgedAt',
    ],
  },
  {
    entity: 'reviews',
    table: 'reviews',
    columns: [
      'id',
      'cardId',
      'resetsLearning',
      'restartId',
      'cancelsReviewId',
      'priorState',
      'reviewedAt',
      'submittedAt',
      'createdAt',
      'rating',
      'durationMs',
      'elapsedDays',
      'scheduledDays',
      'placedDue',
      'stateBefore',
      'stabilityBefore',
      'difficultyBefore',
      'rev',
    ],
  },
  {
    entity: 'learningRestarts',
    table: 'learning_restarts',
    columns: [...owned, 'deckId', 'noteId', 'cardCount'],
  },
  {
    entity: 'studyPresets',
    table: 'study_presets',
    columns: [...owned, 'deckId', 'name', 'config', 'isDefault'],
  },
  {
    entity: 'practiceRuns',
    table: 'practice_runs',
    columns: [...owned, 'deckId', 'version', 'lastOperationId', 'run'],
  },
  {
    entity: 'conflicts',
    table: 'sync_conflicts',
    columns: ['id', 'entity', 'entityId', 'reason', 'losing', 'kept', 'createdAt'],
  },
] as const satisfies readonly { entity: ExportEntity; table: string; columns: readonly string[] }[];

const snake = (value: string) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function pick(value: unknown, keys: readonly string[]) {
  const row = object(value);
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]),
  );
}
const fieldKeys = [
  ...new Set(Object.values(noteFieldsSchemas).flatMap((schema) => Object.keys(schema.shape))),
];
function fields(value: unknown) {
  const result = pick(value, fieldKeys);
  if ('grammar' in result)
    result['grammar'] = pick(
      result['grammar'],
      Object.keys(noteFieldsSchemas.vocab.shape.grammar.unwrap().shape),
    );
  return result;
}
function practice(value: unknown) {
  // Preserve stored versions exactly, including old runs lacking response. Do not reconcile them.
  return value === null
    ? null
    : pick(value, ['id', 'front', 'back', 'response', 'statuses', 'queue', 'round']);
}

/** Strip ownership/internal columns from retained row versions as well as current rows. */
export function exportVersion(entity: string, value: unknown): unknown {
  if (value === null) return null;
  if (entity === 'practiceRuns') {
    const result = pick(value, ['deckId', 'version', 'run']);
    if ('run' in result) result['run'] = practice(result['run']);
    return result;
  }
  const definition = EXPORT_TABLES.find((table) => table.entity === entity);
  if (!definition || entity === 'conflicts' || entity === 'preferences') return {};
  const result = pick(value, [...definition.columns, 'noteType', 'triage']);
  if ('fields' in result) result['fields'] = fields(result['fields']);
  if ('priorState' in result)
    result['priorState'] =
      result['priorState'] === null ? null : pick(result['priorState'], scheduling);
  if ('run' in result) result['run'] = practice(result['run']);
  if (result['purgedAt']) {
    if (entity === 'notes')
      Object.assign(result, { fields: {}, tags: [], source: null, rank: null, triage: null });
    if (entity === 'decks') Object.assign(result, { name: '', settings: null });
  }
  return result;
}

export const EXPORT_GUIDE = {
  scope:
    'Synchronized account-owned learning data visible in one PostgreSQL repeatable-read snapshot. Read-only. Not an import or restore format.',
  reading:
    'UTF-8 JSON Lines: parse each newline-delimited JSON object. The first line is manifest; record lines have entity and data. A complete line is required last, after transaction commit. Reject missing completion, mismatched counts/bytes/exportId or trailing data.',
  timestamps:
    'ISO 8601 instants with explicit UTC offset. Null means not recorded or not applicable; no historical values are inferred. IDs are stable strings; rev/currentRev are account revision counters.',
  relationships:
    'decks.parentId/path -> decks.id; notes.deckId -> decks.id, noteTypeId -> noteTypes.id, importBatchId -> importBatches.id; cards.noteId/deckId -> notes/decks; reviews.cardId -> cards.id, cancelsReviewId -> reviews.id, restartId -> learningRestarts.id; presets/imports/practice/restarts.deckId -> decks.id; restarts.noteId -> notes.id when present.',
  history:
    'Cards are current projections, not events. Reviews preserve answers, cancellations and resets as stored, including priorState when captured. Null priorState/submittedAt is historical absence. Rating/timing fields on cancellation/reset rows are storage placeholders, not answers. Never infer missing events from Card counters. FSRS stability is in days; difficulty is dimensionless; durations are milliseconds.',
  deletion:
    'Soft-deleted rows retain content for recovery. Purged rows are redacted tombstones; retained immutable learning history still references their IDs. Purged content cannot be restored. Conflicts for purged targets expose metadata only.',
  practice:
    'One stored run/version per Deck, without live-membership reconciliation. Historical versions exist only where retained in conflicts; there is no complete command/version history. Queue/status Note IDs may refer to Notes removed from the pool. Practice never changes Reviews or schedules.',
  notes:
    'vocab, basic and cloze fields follow their exported noteTypes definitions. Image/audio fields are stored references, not bundled remote files. Cloze direction plus slot identifies a gap. Triage is the stored mark; null also covers schemas predating triage.',
  conflicts:
    'Retained losing and kept learning versions, with explicit field allowlists. A losing data object is an attempted change, not an accepted event. Unknown entity payloads are omitted; purged targets have payloads redacted. Practice run references may be historical.',
  exclusions:
    'Credentials, authentication profile/session/security state, delivery receipt fingerprints/digests, rate limits, internal normalized search keys and operational secrets. Pending device-only edits/creations/Reviews/Practice/triage, Import drafts/checkpoints, device preferences and local recovery are not included. Import source files and external media are not stored in this archive.',
  limits:
    '128 MiB total, 4 MiB per line, 120 seconds generation. Failure or interruption produces no valid complete archive. Retry starts a fresh snapshot. Keep this private file secure.',
};

export class ExportLimit extends Error {
  constructor() {
    super('export_limit');
  }
}

export function accountExportRepository(db: Database, userId: string) {
  return {
    /** Await each chunk for backpressure; no archive-sized server buffer or writes. */
    async write(write: (line: string) => Promise<void>, signal: AbortSignal): Promise<void> {
      const started = Date.now();
      const exportId = uuidV7();
      const counts = emptyExportCounts();
      let bytes = 0;
      let records = 0;
      function check() {
        if (signal.aborted) throw new Error('export_aborted');
        if (Date.now() - started > 120_000) throw new ExportLimit();
      }
      async function emit(value: unknown) {
        check();
        const line = `${JSON.stringify(value)}\n`;
        const size = Buffer.byteLength(line);
        if (size > EXPORT_MAX_LINE_BYTES || bytes + size > EXPORT_MAX_BYTES)
          throw new ExportLimit();
        await write(line);
        bytes += size;
      }
      await db.transaction(async (tx) => {
        // Must precede nameUser: the first statement fixes the MVCC snapshot.
        await tx.execute(sql`set transaction isolation level repeatable read, read only`);
        await nameUser(tx, userId);
        await tx.execute(sql`set local timezone = 'UTC'`);
        await tx.execute(sql`set local statement_timeout = '15s'`);
        await tx.execute(sql`set local idle_in_transaction_session_timeout = '20s'`);
        const snapshot = await tx.execute<{ snapshot_at: string; revision: number }>(sql`
          select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as snapshot_at,
            current_rev::float8 as revision from "user" where id = ${userId}`);
        const meta = snapshot.rows[0];
        if (!meta) throw new Error('export_account_missing');
        await emit({
          type: 'manifest',
          format: EXPORT_FORMAT,
          version: EXPORT_VERSION,
          exportId,
          accountId: userId,
          snapshotAt: meta.snapshot_at,
          revision: meta.revision,
          entities: EXPORT_ENTITIES,
          guide: EXPORT_GUIDE,
        });
        for (const definition of EXPORT_TABLES) {
          check();
          const { entity, columns } = definition;
          const pairs = columns.map((key) => sql`${key}::text, ${sql.identifier(snake(key))}`);
          // A forward-compatible, single-field allowlist for PR #69; null on older schemas.
          if (entity === 'notes') pairs.push(sql`'triage', to_jsonb(export_source)->'triage'`);
          if (entity === 'conflicts')
            pairs.push(sql`'redacted', case
            when entity = 'notes' then not exists (select 1 from notes n where n.user_id = ${userId} and n.id = export_source.entity_id and n.purged_at is null)
            when entity = 'decks' then not exists (select 1 from decks d where d.user_id = ${userId} and d.id = export_source.entity_id and d.purged_at is null)
            when entity = 'cards' then not exists (select 1 from cards c where c.user_id = ${userId} and c.id = export_source.entity_id and c.purged_at is null)
            when entity in ('practiceRuns', 'studyPresets', 'importBatches') then false
            else true end`);
          let predicate = entity === 'preferences' ? sql`id = ${userId}` : sql`user_id = ${userId}`;
          if (entity === 'noteTypes') predicate = sql`(${predicate} or user_id is null)`;
          // Purge can leave Practice versions referencing redacted Note IDs. They contain no Note fields.
          const query = sql`select jsonb_build_object(${sql.join(pairs, sql`, `)})::text as data
            from ${sql.identifier(definition.table)} as export_source where ${predicate} order by id`;
          await tx.execute(sql`declare neuron_export no scroll cursor for ${query}`);
          const pageSize =
            entity === 'practiceRuns'
              ? 1
              : entity === 'notes' || entity === 'conflicts'
                ? 128
                : 512;
          for (;;) {
            check();
            const page = await tx.execute<{ data: string }>(
              sql`fetch forward ${sql.raw(String(pageSize))} from neuron_export`,
            );
            if (!page.rows.length) break;
            for (const item of page.rows) {
              if (Buffer.byteLength(item.data) > EXPORT_MAX_LINE_BYTES) throw new ExportLimit();
              let data = object(JSON.parse(item.data));
              if (entity === 'conflicts') {
                const redacted = data['redacted'] === true;
                const losing = object(data['losing']);
                data = {
                  ...data,
                  redacted,
                  losing: redacted
                    ? {}
                    : 'data' in losing
                      ? {
                          ...pick(losing, ['updatedAt']),
                          data: exportVersion(String(data['entity']), losing['data']),
                        }
                      : exportVersion(String(data['entity']), data['losing']),
                  kept: redacted ? null : exportVersion(String(data['entity']), data['kept']),
                };
              } else if (entity !== 'preferences' && entity !== 'noteTypes') {
                data = object(exportVersion(entity, data));
              }
              await emit({ type: 'record', entity, data });
              counts[entity]++;
              records++;
            }
          }
          await tx.execute(sql`close neuron_export`);
        }
      });
      // A committed snapshot, not a successful last FETCH, makes an archive complete.
      await emit({ type: 'complete', exportId, records, counts, bytes });
    },
  };
}
