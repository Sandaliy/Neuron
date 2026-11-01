import process from 'node:process';

import { parseNoteFields, possibleCards } from '@neuron/shared';

import { requireUrl, withPool } from '../tooling.js';

import type { Pool } from '@neondatabase/serverless';

export interface AssessmentCard {
  readonly id: string;
  readonly slot: number;
  readonly deleted: boolean;
  readonly suspended: boolean;
  /** Every immutable row, including answers before a reset and cancellation events. */
  readonly reviewRows: number;
  readonly pristine: boolean;
}

export interface AssessmentNote {
  readonly id: string;
  readonly fields: unknown;
  readonly deleted: boolean;
  readonly active: boolean;
  readonly cards: readonly AssessmentCard[];
}

/** Assessment only: a candidate is never authorization to write. */
export function assessClozeNote(note: AssessmentNote) {
  let slots: number[];
  try {
    slots = possibleCards('cloze', parseNoteFields('cloze', note.fields)).map((card) => card.slot);
  } catch {
    slots = [];
  }
  // Explicit {{c0::answer}} is accepted by the current parser. Slot 0 alone
  // therefore does not prove corruption; matching the canonical face does.
  if (slots.includes(0)) return [];

  return note.cards
    .filter((card) => card.slot === 0)
    .map((card) => {
      const liveCollisions = slots.filter((slot) =>
        note.cards.some((other) => other.slot === slot && !other.deleted),
      );
      const historicalCollisions = slots.filter((slot) =>
        note.cards.some((other) => other.slot === slot && other.deleted),
      );
      const resolution =
        card.deleted || note.deleted
          ? 'retained-deleted'
          : slots.length === 0
            ? 'invalid-note'
            : liveCollisions.length > 0
              ? 'live-collision'
              : historicalCollisions.length > 0
                ? 'historical-collision'
                : slots.length !== 1
                  ? 'ambiguous-gap'
                  : card.reviewRows > 0 || !card.pristine
                    ? 'reviewed-or-stateful'
                    : 'single-gap-unreviewed-candidate';
      return {
        noteId: note.id,
        cardId: card.id,
        resolution,
        validSlots: slots,
        liveCollisions,
        historicalCollisions,
        missingSlots: slots.filter((slot) => !liveCollisions.includes(slot)),
        reviewRows: card.reviewRows,
        activeNote: note.active,
        suspendedCard: card.suspended,
      };
    });
}

/**
 * A user-bound, consistent, read-only snapshot. Includes deleted siblings and
 * all Review events; neither reps nor the current replay window proves that
 * a Card has never been answered. No Note content leaves this function.
 */
export async function assessStoredClozes(pool: Pool, userId: string) {
  if (!userId.trim()) throw new Error('An explicit user id is required.');
  const connection = await pool.connect();
  try {
    await connection.query('begin isolation level repeatable read read only');
    await connection.query("select set_config('app.user_id', $1, true)", [userId]);
    const notes = await connection.query<{
      id: string;
      fields: unknown;
      deleted: boolean;
      active: boolean;
      cards: AssessmentCard[];
    }>(
      `select n.id, n.fields, n.deleted_at is not null as deleted,
              n.status = 'active' as active,
              (select jsonb_agg(jsonb_build_object(
                'id', c.id, 'slot', c.slot,
                'deleted', c.deleted_at is not null,
                'suspended', c.suspended_at is not null,
                'reviewRows', (select count(*) from reviews r
                  where r.user_id = $1 and r.card_id = c.id),
                'pristine', c.state = 'new' and c.reps = 0 and c.lapses = 0
                  and c.stability is null and c.difficulty is null
                  and c.last_review is null and c.reset_at is null
                  and c.learning_step = 0 and c.placed_due is null
              ) order by c.slot, c.id) from cards c
                where c.user_id = $1 and c.note_id = n.id and c.direction = 'cloze') as cards
       from notes n join note_types nt on nt.id = n.note_type_id
       where n.user_id = $1 and nt.is_system and nt.name = 'cloze'
         and exists (select 1 from cards z where z.user_id = $1
           and z.note_id = n.id and z.direction = 'cloze' and z.slot = 0)
       order by n.id`,
      [userId],
    );
    return notes.rows.flatMap(assessClozeNote);
  } finally {
    await connection.query('rollback');
    connection.release();
  }
}

async function main() {
  const [userId, details, ...extra] = process.argv.slice(2);
  if (!userId || (details !== undefined && details !== '--details') || extra.length > 0) {
    throw new Error('Usage: cloze-assessment.ts <user-id> [--details]');
  }
  // Deliberately no DATABASE_URL fallback: the operator chooses the target.
  const url = requireUrl('CLOZE_ASSESS_DATABASE_URL', 'Choose an explicit assessment connection.');
  const findings = await withPool(url, (pool) => assessStoredClozes(pool, userId));
  const counts: Record<string, number> = {};
  for (const finding of findings)
    counts[finding.resolution] = (counts[finding.resolution] ?? 0) + 1;
  console.log(
    JSON.stringify(
      { affectedCards: findings.length, counts, ...(details === '--details' ? { findings } : {}) },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch(() => {
    // Driver errors can contain connection details or SQL values.
    console.error('Cloze assessment failed. Check the explicit connection, user id and arguments.');
    process.exitCode = 1;
  });
}
