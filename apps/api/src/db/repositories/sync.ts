import { and, asc, eq, gt, isNull } from 'drizzle-orm';

import { parseNoteFields, uuidV7 } from '@neuron/shared';
import type { NoteFields, NoteStatus, NoteTypeName, SyncEntity } from '@neuron/shared';

import {
  cards,
  decks,
  importBatches,
  noteTypes,
  notes,
  reviews,
  studyPresets,
  syncConflicts,
  user,
} from '../schema/index.js';

import { UnknownNoteType } from './notes.js';
import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

/**
 * Sync: one revision stream out, one batch of changes in.
 *
 * Every table a user owns carries `rev`, the value of that user's counter when
 * the row was last written. That turns "what changed since I last looked" into
 * one ordered read rather than six timestamp comparisons that can disagree with
 * each other. The counter is taken under a row lock, so two devices writing at
 * the same moment queue up rather than both getting the same number: sync
 * depends on the sequence having no gaps and no repeats, which is why it is a
 * counter on the user row and not a clock.
 *
 * Coming the other way, entities merge by last write wins and reviews do not
 * merge at all. A review is appended and cannot conflict, because the same id
 * arriving twice is the same fact arriving twice. An entity can genuinely have
 * been edited in two places, so one edit loses, and the losing version is
 * written to the conflict log rather than dropped.
 */

/** One changed row, as it goes over the wire. */
export interface SyncRow {
  readonly entity: SyncEntity;
  readonly id: string;
  readonly rev: number;
  readonly deleted: boolean;
  readonly row: Record<string, unknown>;
}

export interface PullResult {
  readonly since: number;
  readonly revision: number;
  readonly hasMore: boolean;
  readonly changes: SyncRow[];
}

/** The entities a client may push. Reviews take the other path. */
export type PushableEntity = Exclude<SyncEntity, 'reviews'>;

/** One row's worth of change coming in. */
export interface IncomingChange {
  readonly entity: PushableEntity;
  readonly id: string;
  readonly updatedAt: Date;
  readonly deleted: boolean;
  readonly data?: Record<string, unknown> | undefined;
}

export interface ConflictedChange {
  readonly entity: SyncEntity;
  readonly id: string;
  readonly reason: 'older_update' | 'deleted_remotely';
  readonly keptRev: number;
}

export interface PushResult {
  readonly applied: { entity: SyncEntity; id: string }[];
  readonly conflicts: ConflictedChange[];
  readonly clamped: string[];
  readonly revision: number;
}

export interface SyncRepository {
  /** The user's counter as it stands now. */
  revision: () => Promise<number>;
  pull: (since: number, limit: number) => Promise<PullResult>;
  /**
   * Applies a batch of client changes.
   *
   * Runs inside whatever transaction it is handed, so a caller that also has
   * reviews to append puts both in one unit and a failure anywhere rolls the
   * whole thing back. Everything written here shares one version number, so a
   * client pulling afterwards sees the batch arrive as one step.
   */
  push: (changes: readonly IncomingChange[], now: Date) => Promise<PushResult>;
}

/**
 * How far ahead of the server a client's clock may be before it is disbelieved.
 *
 * Phones are usually right to the second and are occasionally a year out. Five
 * minutes is past any plausible drift and short enough that a device claiming
 * the future cannot win every conflict it takes part in from now on.
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The tables in the stream.
 *
 * Reading is the same shape for all of them, so it is written once. Writing is
 * not: each table has its own columns and its own validation, and a generic
 * writer would have to be told about them anyway, in a form the compiler could
 * not check. So the reads share this map and the writes are spelled out.
 */
const READABLE = { decks, notes, cards, studyPresets, importBatches, reviews } as const;

/** The order rows are written in, so a foreign key is never left pointing at a gap. */
const APPLY_ORDER: readonly PushableEntity[] = [
  'decks',
  'importBatches',
  'notes',
  'cards',
  'studyPresets',
];

/**
 * Reads one table's changed rows.
 *
 * `limit + 1` rather than `limit`, so that "is there more" is answered by
 * looking at what came back rather than by counting the table.
 */
async function changedRows(
  tx: Tx,
  userId: string,
  entity: keyof typeof READABLE,
  since: number,
  limit: number,
): Promise<SyncRow[]> {
  const table = READABLE[entity];

  const rows = (await tx
    .select()
    .from(table)
    .where(and(eq(table.userId, userId), gt(table.rev, since)))
    .orderBy(asc(table.rev))
    .limit(limit + 1)) as unknown as Record<string, unknown>[];

  return rows.map((row) => ({
    entity,
    id: String(row['id']),
    rev: Number(row['rev']),
    // The review log has no deleted_at, because it is append only and the
    // column would be a lie about what can happen to a row in it. The lookup
    // simply finds nothing there, which is the right answer.
    deleted: row['deletedAt'] instanceof Date,
    row,
  }));
}

/** What a pushed deck carries. */
interface DeckPayload {
  name?: unknown;
  parentId?: unknown;
  position?: unknown;
  settings?: unknown;
}

/** What a pushed note carries. */
interface NotePayload {
  deckId?: unknown;
  noteType?: unknown;
  fields?: unknown;
  tags?: unknown;
  source?: unknown;
  rank?: unknown;
  status?: unknown;
  importBatchId?: unknown;
}

export function syncRepository(userId: string, run: Runner): SyncRepository {
  /**
   * Writes the version that lost a merge, before the winner overwrites it.
   *
   * Last write wins is the rule. A rule that silently destroys the losing
   * version is a rule that eventually destroys the version somebody cared
   * about, so it is kept and can be read back.
   */
  async function recordConflict(
    tx: Tx,
    change: IncomingChange,
    kept: Record<string, unknown> | undefined,
    reason: ConflictedChange['reason'],
  ): Promise<void> {
    await tx.insert(syncConflicts).values({
      id: uuidV7(),
      userId,
      entity: change.entity,
      entityId: change.id,
      reason,
      losing: { updatedAt: change.updatedAt.toISOString(), data: change.data ?? null },
      // Through JSON so that a Date becomes a string rather than an empty
      // object, which is what putting a row straight into jsonb produces.
      kept: kept === undefined ? null : JSON.parse(JSON.stringify(kept)),
    });
  }

  /**
   * Resolves a note type name to its row id, remembering what it has looked up.
   *
   * A batch of five hundred notes is usually five hundred notes of one type.
   */
  function typeResolver(tx: Tx) {
    const known = new Map<string, string>();

    return async (name: string): Promise<string> => {
      const cached = known.get(name);

      if (cached !== undefined) {
        return cached;
      }

      const [row] = await tx
        .select({ id: noteTypes.id })
        .from(noteTypes)
        .where(and(eq(noteTypes.name, name), isNull(noteTypes.deletedAt)))
        .limit(1);

      if (!row) {
        throw new UnknownNoteType(name);
      }

      known.set(name, row.id);

      return row.id;
    };
  }

  return {
    async revision() {
      return run(async (tx) => {
        const [row] = await tx
          .select({ currentRev: user.currentRev })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);

        if (!row) {
          throw new Error(`no user row for ${userId}`);
        }

        return row.currentRev;
      });
    },

    async pull(since, limit) {
      return run(async (tx) => {
        const perTable = await Promise.all(
          (Object.keys(READABLE) as (keyof typeof READABLE)[]).map((entity) =>
            changedRows(tx, userId, entity, since, limit),
          ),
        );

        const merged = perTable
          .flat()
          .sort((left, right) => left.rev - right.rev || left.id.localeCompare(right.id));

        const [current] = await tx
          .select({ currentRev: user.currentRev })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);

        const head = current?.currentRev ?? since;

        if (merged.length <= limit) {
          return { since, revision: head, hasMore: false, changes: merged };
        }

        /**
         * A page has to end on a revision boundary.
         *
         * One transaction takes one revision and can write several rows under
         * it. Cutting between two of those would let a client resume from a
         * number it only half received, and it would never find out. So the cut
         * moves back to the last complete revision, and a single transaction
         * larger than the page is sent whole rather than split.
         */
        const boundary = merged[limit - 1]?.rev ?? since;
        const changes = merged.filter((change) => change.rev <= boundary);
        const revision = changes.at(-1)?.rev ?? since;

        return { since, revision, hasMore: revision < head, changes };
      });
    },

    async push(changes, now) {
      return run(async (tx) => {
        const rev = await nextRev(tx, userId);
        const noteTypeIdFor = typeResolver(tx);
        const applied: { entity: SyncEntity; id: string }[] = [];
        const conflicts: ConflictedChange[] = [];
        const clamped: string[] = [];
        const ceiling = new Date(now.getTime() + MAX_CLOCK_SKEW_MS);

        for (const entity of APPLY_ORDER) {
          for (const change of changes) {
            if (change.entity !== entity) {
              continue;
            }

            // A clock ahead of ours is pulled back rather than believed. A
            // device a year fast would otherwise win every conflict it took
            // part in, for a year, and nobody would be able to say why.
            const wasClamped = change.updatedAt > ceiling;
            const updatedAt = wasClamped ? now : change.updatedAt;

            if (wasClamped) {
              clamped.push(change.id);
            }

            const existing = await currentRow(tx, userId, entity, change.id);

            if (existing) {
              const theirs = existing['updatedAt'];
              const kept = theirs instanceof Date ? theirs : new Date(0);

              if (updatedAt <= kept) {
                await recordConflict(tx, change, existing, 'older_update');
                conflicts.push({
                  entity,
                  id: change.id,
                  reason: 'older_update',
                  keptRev: Number(existing['rev']),
                });

                continue;
              }
            } else if (entity === 'cards') {
              // Cards are never created by a client: one follows from a note
              // and a direction. A change for a card the server does not have
              // means the note it belonged to is gone, so the edit has nothing
              // to attach to and the client is told rather than left guessing.
              await recordConflict(tx, change, undefined, 'deleted_remotely');
              conflicts.push({ entity, id: change.id, reason: 'deleted_remotely', keptRev: 0 });

              continue;
            }

            if (change.deleted) {
              if (existing) {
                await softDeleteRow(tx, userId, entity, change.id, updatedAt, rev);
              }

              applied.push({ entity, id: change.id });

              continue;
            }

            await writeRow({
              tx,
              userId,
              entity,
              id: change.id,
              data: change.data ?? {},
              updatedAt,
              rev,
              exists: existing !== undefined,
              noteTypeIdFor,
            });

            applied.push({ entity, id: change.id });
          }
        }

        return { applied, conflicts, clamped, revision: rev };
      });
    },
  };
}

/**
 * The row as the server currently has it, deleted or not.
 *
 * Soft deleted rows are included on purpose: a client editing something that
 * was deleted elsewhere has to be told, and a query that hid the row would
 * report the edit as applied to nothing.
 */
async function currentRow(
  tx: Tx,
  userId: string,
  entity: PushableEntity,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const table = READABLE[entity];

  const [row] = (await tx
    .select()
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.id, id)))
    .limit(1)) as unknown as Record<string, unknown>[];

  return row;
}

/** Marks a row deleted. Nothing here ever removes one. */
async function softDeleteRow(
  tx: Tx,
  userId: string,
  entity: PushableEntity,
  id: string,
  at: Date,
  rev: number,
): Promise<void> {
  const marked = { deletedAt: at, updatedAt: at, rev };

  switch (entity) {
    case 'decks':
      await tx
        .update(decks)
        .set(marked)
        .where(and(eq(decks.userId, userId), eq(decks.id, id)));

      return;

    case 'notes':
      await tx
        .update(notes)
        .set(marked)
        .where(and(eq(notes.userId, userId), eq(notes.id, id)));
      await tx
        .update(cards)
        .set(marked)
        .where(and(eq(cards.userId, userId), eq(cards.noteId, id)));

      return;

    case 'cards':
      await tx
        .update(cards)
        .set(marked)
        .where(and(eq(cards.userId, userId), eq(cards.id, id)));

      return;

    case 'studyPresets':
      await tx
        .update(studyPresets)
        .set(marked)
        .where(and(eq(studyPresets.userId, userId), eq(studyPresets.id, id)));

      return;

    case 'importBatches':
      await tx
        .update(importBatches)
        .set(marked)
        .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));
  }
}

interface WriteRow {
  readonly tx: Tx;
  readonly userId: string;
  readonly entity: PushableEntity;
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly updatedAt: Date;
  readonly rev: number;
  readonly exists: boolean;
  readonly noteTypeIdFor: (name: string) => Promise<string>;
}

/**
 * Writes one pushed row.
 *
 * Spelled out per table rather than driven by a map, because each one has its
 * own columns and its own validation, and a generic version would have to be
 * handed all of that in a shape the compiler could not check.
 *
 * A note's fields are parsed against the schema for its type here, exactly as
 * the note repository does it. Sync is a second door into the same table, and a
 * door that skipped the check would make the guarantee worthless.
 */
async function writeRow(input: WriteRow): Promise<void> {
  const { userId, id, updatedAt, rev, exists } = input;
  const base = { updatedAt, rev, deletedAt: null };

  switch (input.entity) {
    case 'decks': {
      const payload = input.data as DeckPayload;
      const columns = {
        name: String(payload.name ?? '').trim(),
        parentId: (payload.parentId as string | null | undefined) ?? null,
        settings: (payload.settings as never) ?? null,
        ...(payload.position === undefined ? {} : { position: Number(payload.position) }),
      };

      if (exists) {
        await input.tx
          .update(decks)
          .set({ ...columns, ...base })
          .where(and(eq(decks.userId, userId), eq(decks.id, id)));

        return;
      }

      // The path is left empty and the deck sits at the root of whatever it
      // claims as a parent until the next move rewrites it. Working it out here
      // would mean reading the parent that may be later in the same batch.
      await input.tx.insert(decks).values({ ...columns, id, userId, path: [], updatedAt, rev });

      return;
    }

    case 'notes': {
      const payload = input.data as NotePayload;
      const type = payload.noteType as NoteTypeName;
      const columns = {
        deckId: payload.deckId as string,
        noteTypeId: await input.noteTypeIdFor(type),
        fields: parseNoteFields(type, payload.fields) as NoteFields,
        tags: (payload.tags as string[] | undefined) ?? [],
        source: (payload.source as string | null | undefined) ?? null,
        rank: (payload.rank as number | null | undefined) ?? null,
        status: ((payload.status as NoteStatus | undefined) ?? 'active') as NoteStatus,
        importBatchId: (payload.importBatchId as string | null | undefined) ?? null,
      };

      if (exists) {
        await input.tx
          .update(notes)
          .set({ ...columns, ...base })
          .where(and(eq(notes.userId, userId), eq(notes.id, id)));

        return;
      }

      await input.tx.insert(notes).values({ ...columns, id, userId, updatedAt, rev });

      return;
    }

    case 'cards': {
      // Only the field a client owns. Everything about the schedule is the
      // server's, derived from the review log, for the same reason the review
      // endpoint recomputes rather than believes: a client that could push a
      // stability would not need to forge a review at all.
      const suspendedAt = input.data['suspendedAt'];

      await input.tx
        .update(cards)
        .set({
          suspendedAt: suspendedAt instanceof Date ? suspendedAt : null,
          ...base,
        })
        .where(and(eq(cards.userId, userId), eq(cards.id, id)));

      return;
    }

    case 'studyPresets': {
      const columns = {
        name: String(input.data['name'] ?? '').trim(),
        deckId: (input.data['deckId'] as string | null | undefined) ?? null,
        config: input.data['config'] ?? {},
        isDefault: Boolean(input.data['isDefault'] ?? false),
      };

      if (exists) {
        await input.tx
          .update(studyPresets)
          .set({ ...columns, ...base })
          .where(and(eq(studyPresets.userId, userId), eq(studyPresets.id, id)));

        return;
      }

      await input.tx.insert(studyPresets).values({ ...columns, id, userId, updatedAt, rev });

      return;
    }

    case 'importBatches': {
      const undoneAt = input.data['undoneAt'];
      const columns = {
        deckId: input.data['deckId'] as string,
        source: String(input.data['source'] ?? ''),
        format: String(input.data['format'] ?? 'json'),
        noteCount: Number(input.data['noteCount'] ?? 0),
        undoneAt: undoneAt instanceof Date ? undoneAt : null,
      };

      if (exists) {
        await input.tx
          .update(importBatches)
          .set({ ...columns, ...base })
          .where(and(eq(importBatches.userId, userId), eq(importBatches.id, id)));

        return;
      }

      await input.tx.insert(importBatches).values({ ...columns, id, userId, updatedAt, rev });
    }
  }
}
