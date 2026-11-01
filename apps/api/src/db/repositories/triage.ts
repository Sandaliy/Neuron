import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { TRIAGE_STATUSES, triageChoiceOf, triageWrite } from '@neuron/shared';
import type {
  NoteStatus,
  TriageChoice,
  TriageMark,
  TriageResult,
  TRIAGE_SKIPS,
} from '@neuron/shared';

import { decks, notes, user } from '../schema/index.js';

import { nextRev } from './session.js';

import type { Runner, Tx } from './session.js';

/**
 * Triage over the database: which Notes it applies to, and recording a decision.
 *
 * A decision writes the Note's status and its triage mark and nothing else. No
 * Card, Review or due date is read for writing, so a classification can never
 * stand in for an answer. The rule that triage only applies to Notes without
 * learning history is checked here, under the account write lock, because the
 * device that made the decision may have made it offline while another device
 * was studying the same word.
 */

/** A Note triage applies to, before it is given a face. */
export interface TriageRow {
  readonly id: string;
  readonly deckId: string;
  readonly noteTypeId: string;
  readonly rank: number | null;
  readonly choice: TriageChoice;
  readonly fields: unknown;
}

export interface TriageRows {
  readonly items: readonly TriageRow[];
  readonly studied: number;
  readonly setAside: number;
}

export interface TriageRepository {
  /** The Notes under a live Folder or Deck, in source order, or undefined when it is not there. */
  list: (deckId: string) => Promise<TriageRows | undefined>;
  /** Applies what still may be applied. Retrying the same decisions changes nothing more. */
  decide: (
    decisions: readonly { readonly id: string; readonly choice: TriageChoice }[],
  ) => Promise<TriageResult>;
}

/**
 * A Card of the Note has left `new`: learning history exists, and Study owns the Note.
 *
 * The outer column is spelled out. Inside a select list Drizzle renders a column
 * without its table, and a bare `id` here would be the Card's own.
 */
function studiedOf(userId: string) {
  return sql<boolean>`exists (
    select 1 from cards c
     where c.user_id = ${userId}
       and c.note_id = "notes"."id"
       and c.deleted_at is null
       and c.state <> 'new'
  )`;
}

type Skip = (typeof TRIAGE_SKIPS)[number];

function triageable(status: string): status is (typeof TRIAGE_STATUSES)[number] {
  return (TRIAGE_STATUSES as readonly string[]).includes(status);
}

async function lockAccount(tx: Tx, userId: string): Promise<void> {
  await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
}

export function triageRepository(userId: string, run: Runner): TriageRepository {
  return {
    async list(deckId) {
      return run(async (tx) => {
        const [root] = await tx
          .select({ id: decks.id })
          .from(decks)
          .where(and(eq(decks.userId, userId), eq(decks.id, deckId), isNull(decks.deletedAt)))
          .limit(1);
        if (!root) return undefined;

        const under = tx
          .select({ id: decks.id })
          .from(decks)
          .where(
            and(
              eq(decks.userId, userId),
              isNull(decks.deletedAt),
              sql`(${decks.id} = ${deckId} or ${decks.path} @> array[${deckId}]::uuid[])`,
            ),
          );
        const rows = await tx
          .select({
            id: notes.id,
            deckId: notes.deckId,
            noteTypeId: notes.noteTypeId,
            rank: notes.rank,
            status: notes.status,
            triage: notes.triage,
            fields: notes.fields,
            studied: studiedOf(userId),
          })
          .from(notes)
          .where(
            and(
              eq(notes.userId, userId),
              isNull(notes.deletedAt),
              isNull(notes.purgedAt),
              inArray(notes.deckId, under),
            ),
          )
          // Ids are UUID version 7, so this is creation order: the order of the imported file.
          .orderBy(asc(notes.id));

        const items: TriageRow[] = [];
        let studied = 0;
        let setAside = 0;
        for (const row of rows) {
          const choice = triageChoiceOf(row.status as NoteStatus, row.triage as TriageMark | null);
          if (choice === undefined) setAside++;
          else if (row.studied) studied++;
          else
            items.push({
              id: row.id,
              deckId: row.deckId,
              noteTypeId: row.noteTypeId,
              rank: row.rank,
              choice,
              fields: row.fields,
            });
        }
        return { items, studied, setAside };
      });
    },

    async decide(decisions) {
      return run(async (tx) => {
        // Serialized with answers, edits and status changes, which all take
        // this row to allocate a revision. A Card cannot be answered between
        // the check below and the write.
        await lockAccount(tx, userId);
        const ids = decisions.map((decision) => decision.id);
        const rows = await tx
          .select({
            id: notes.id,
            status: notes.status,
            triage: notes.triage,
            studied: studiedOf(userId),
          })
          .from(notes)
          .where(
            and(
              eq(notes.userId, userId),
              inArray(notes.id, ids),
              isNull(notes.deletedAt),
              isNull(notes.purgedAt),
            ),
          );
        const byId = new Map(rows.map((row) => [row.id, row]));

        const applied: TriageResult['applied'] = [];
        const skipped: { id: string; reason: Skip }[] = [];
        const writes = new Map<TriageChoice, string[]>();
        for (const { id, choice } of decisions) {
          const row = byId.get(id);
          if (!row) {
            skipped.push({ id, reason: 'missing' });
            continue;
          }
          if (!triageable(row.status)) {
            skipped.push({ id, reason: 'set_aside' });
            continue;
          }
          if (row.studied) {
            skipped.push({ id, reason: 'studied' });
            continue;
          }
          applied.push({ id, choice });
          const target = triageWrite(choice);
          if (row.status !== target.status || (row.triage ?? null) !== target.triage)
            writes.set(choice, [...(writes.get(choice) ?? []), id]);
        }

        if (writes.size > 0) {
          const rev = await nextRev(tx, userId);
          const now = new Date();
          for (const [choice, group] of writes) {
            const target = triageWrite(choice);
            await tx
              .update(notes)
              .set({ status: target.status, triage: target.triage, updatedAt: now, rev })
              .where(and(eq(notes.userId, userId), inArray(notes.id, group)));
          }
        }

        return { applied, skipped };
      });
    },
  };
}
