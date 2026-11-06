import {
  CARD_STATES,
  createSchedulerConfig,
  newCard,
  projectReviewEvents,
  reviewProjectionOrigin,
} from '@neuron/core';
import type { ReviewEvent, SchedulingState } from '@neuron/core';
import {
  createOfflineDeckResultSchema,
  createOfflineNoteResultSchema,
  clozeGaps,
  deckSettingsSchema,
  editOfflineNoteResultSchema,
  isPracticeRunConsistent,
  noteTypeSchema,
  parseNoteFields,
  possibleCards,
  practiceRunSchema,
  renameDeckResultSchema,
  timeZoneSchema,
} from '@neuron/shared';

import { fromSchedulingState, toReviewLog, toSchedulingState } from '../repositories/mapping.js';

import { addFinding, safeReceiptCursor } from './audit.js';

import type { AuditLimits, AuditOptions, AuditQuery, AuditReport } from './audit.js';
import type { CardStateRow, ReviewLogRow } from '../repositories/mapping.js';

interface StoredCard extends CardStateRow {
  id: string;
  resetAt: Date | null;
  deleted: boolean;
  purged: boolean;
  direction: string;
  slot: number;
  fields: unknown;
  system: boolean;
  type: string;
  oversized: boolean;
}

interface StoredEvent extends ReviewLogRow {
  id: string;
  order: string;
  resetsLearning: boolean;
  cancelsReviewId: string | null;
  priorState: Record<string, unknown> | null;
  oversized: boolean;
}

/** Bounded content validation; no field values, schema errors or faces reach the report. */
export async function verifyDeep(
  query: AuditQuery,
  options: AuditOptions,
  limits: AuditLimits,
  report: AuditReport,
) {
  const finding = (
    check: string,
    severity: 'error' | 'warning' | 'info',
    context: string,
    id?: string,
  ) => addFinding(report, options.details, check, severity, context, id);
  const unverified = (check: string, context: string, id?: string) => {
    finding(check, 'info', context, id);
    report.coverage['verification'] = { scanned: 0, complete: false };
  };
  const [account] = await query<{ timezone: string; cutoff: number; settings: unknown }>(
    'select timezone, day_cutoff_hour as cutoff, settings from "user" where id=$1',
    [options.userId],
  );
  const settings = deckSettingsSchema.safeParse(account?.settings);
  const timezone = timeZoneSchema.safeParse(account?.timezone);
  if (!settings.success || !timezone.success || !account) {
    finding(
      'account-settings',
      'warning',
      'Current shared settings validation failed; canonical replay is unavailable.',
    );
    unverified('replay-settings-unavailable', 'Review account settings before targeted replay.');
    return;
  }
  const config = createSchedulerConfig({
    timezone: timezone.data,
    dayCutoffHour: account.cutoff,
    ...(settings.data.targetRetention === undefined
      ? {}
      : { desiredRetention: settings.data.targetRetention }),
  });

  // Each phase has a keyset cursor and a hard row cap. Only maintained receipt
  // fingerprint formats are safe to expose as optional continuation cursors.
  async function pages<T extends { id: string }>(
    name: string,
    sql: string,
    after: string | undefined,
    consume: (row: T) => Promise<void> | void,
  ) {
    const coverage: AuditReport['coverage'][string] = {
      scanned: 0,
      complete: false,
      after: after ?? '',
    };
    report.coverage[name] = coverage;
    let cursor = after ?? null;
    while (coverage.scanned < limits.maxItems) {
      const size = Math.min(limits.pageSize, limits.maxItems - coverage.scanned);
      const rows = await query<T>(sql, [
        options.userId,
        cursor,
        size + 1,
        options.cardId ?? null,
        options.deckId ?? null,
      ]);
      for (const row of rows.slice(0, size)) {
        await consume(row);
        coverage.scanned++;
        cursor = row.id;
      }
      if (options.details && cursor && (name !== 'receipts' || safeReceiptCursor(cursor)))
        coverage.after = cursor;
      else delete coverage.after;
      if (rows.length <= size) {
        coverage.complete = true;
        break;
      }
    }
  }

  await pages<{ id: string; fields: unknown; system: boolean; type: string; oversized: boolean }>(
    'notes',
    `select n.id, t.is_system as system, t.name as type,
      octet_length(n.fields::text)>65536 as oversized,
      case when octet_length(n.fields::text)<=65536 then n.fields else null end as fields
     from notes n left join note_types t on t.id=n.note_type_id and (t.user_id=$1 or t.user_id is null)
     where n.user_id=$1 and n.purged_at is null and ($2::uuid is null or n.id>$2)
       and ($4::uuid is null or exists(select 1 from cards c where c.user_id=$1 and c.id=$4 and c.note_id=n.id))
       and ($5::uuid is null or n.deck_id=$5) order by n.id limit $3`,
    options.afterNote,
    (row) => {
      if (row.oversized) {
        unverified(
          'note-size-limit',
          'Note exceeds 64 KiB validation limit; inspect this Note confidentially.',
          row.id,
        );
        return;
      }
      const type = noteTypeSchema.safeParse(row.type);
      if (!row.system || !type.success) {
        unverified(
          'custom-note-type',
          'Custom/unrecognized type requires its own validator; no built-in shape is assumed.',
          row.id,
        );
        return;
      }
      try {
        parseNoteFields(type.data, row.fields);
      } catch {
        finding(
          'note-fields',
          'warning',
          'Current shared Note schema rejects retained content. Assess legacy schema and rendering before declaring corruption.',
          row.id,
        );
      }
    },
  );

  await pages<StoredCard>(
    'cards',
    `select c.id,c.state,c.stability,c.difficulty,c.due,c.reps,c.lapses,
      c.learning_step as "learningStep",c.last_review as "lastReview",c.reset_at as "resetAt",
      c.deleted_at is not null as deleted,c.purged_at is not null as purged,c.direction,c.slot,
      t.is_system as system,t.name as type,octet_length(n.fields::text)>65536 as oversized,
      case when octet_length(n.fields::text)<=65536 then n.fields else null end as fields
    from cards c left join notes n on n.id=c.note_id and n.user_id=$1
      left join note_types t on t.id=n.note_type_id and (t.user_id=$1 or t.user_id is null)
    where c.user_id=$1 and ($2::uuid is null or c.id>$2)
      and ($4::uuid is null or c.id=$4) and ($5::uuid is null or c.deck_id=$5)
    order by c.id limit $3`,
    options.afterCard,
    async (card) => {
      if (!card.deleted && !card.purged && !card.oversized && card.system) {
        const type = noteTypeSchema.safeParse(card.type);
        if (type.success) {
          try {
            const fields = parseNoteFields(type.data, card.fields);
            // The full planner builds both faces of every gap. Bound its
            // expansion before calling it, using the same maintained parser.
            if (
              type.data === 'cloze' &&
              'text' in fields &&
              new Set(clozeGaps(fields.text).map((gap) => gap.number)).size > 64
            ) {
              unverified(
                'cloze-expansion-limit',
                'More than 64 distinct gaps; face expansion was skipped. Inspect this Note with a targeted semantic assessment.',
                card.id,
              );
            } else {
              const planned = possibleCards(type.data, fields);
              if (!planned.some((p) => p.direction === card.direction && p.slot === card.slot))
                finding(
                  type.data === 'cloze' && card.direction === 'cloze' && card.slot === 0
                    ? 'legacy-cloze-slot'
                    : 'card-face-unavailable',
                  'warning',
                  'Live identity has no current face. Legacy Cloze, changed fields and historical types require semantic assessment; do not retarget or merge history.',
                  card.id,
                );
            }
          } catch {
            /* The Note validation phase reports the schema rejection. */
          }
        }
      }
      if (!validSchedule(card)) {
        unverified('replay-invalid-card', 'Structural schedule failure prevents replay.', card.id);
        return;
      }
      const rows = await query<StoredEvent>(
        `select id,rev::text as "order",rating,reviewed_at as "reviewedAt",
        elapsed_days as "elapsedDays",scheduled_days as "scheduledDays",placed_due as "placedDue",
        state_before as "stateBefore",stability_before as "stabilityBefore",difficulty_before as "difficultyBefore",
        duration_ms as "durationMs",resets_learning as "resetsLearning",cancels_review_id as "cancelsReviewId",
        octet_length(prior_state::text)>4096 as oversized,
        case when octet_length(prior_state::text)<=4096 then prior_state else null end as "priorState"
        from reviews where user_id=$1 and card_id=$2 and ($3::timestamptz is null or reviewed_at>=$3)
        order by reviewed_at,id limit $4`,
        [options.userId, card.id, card.resetAt, limits.maxEvents + 1],
      );
      if (rows.length > limits.maxEvents) {
        unverified(
          'replay-event-limit',
          'Current-life history exceeds maxEvents; rerun this Card with a larger bounded limit.',
          card.id,
        );
        return;
      }
      const events: ReviewEvent[] = [];
      try {
        for (const row of rows) {
          const prior = row.priorState;
          let state: SchedulingState | undefined;
          if (row.oversized) throw new Error('prior-size');
          if (prior) {
            const decoded = {
              ...prior,
              due: new Date(String(prior['due'])),
              lastReview: prior['lastReview'] ? new Date(String(prior['lastReview'])) : null,
            } as unknown as CardStateRow;
            if (!validSchedule(decoded)) throw new Error('prior-shape');
            state = toSchedulingState(decoded);
          }
          if (!Number.isSafeInteger(Number(row.order))) throw new Error('revision-range');
          events.push({
            id: row.id,
            order: Number(row.order),
            log: toReviewLog(row),
            resetsLearning: row.resetsLearning,
            cancelsReviewId: row.cancelsReviewId,
            ...(state ? { priorState: state } : {}),
          });
        }
        if (
          !events.some(
            (event) =>
              event.priorState ||
              event.resetsLearning ||
              (!event.cancelsReviewId && event.log.stateBefore === 'new'),
          )
        ) {
          if (events.length || card.state !== 'new')
            unverified(
              'replay-origin-unproven',
              'No usable current-life origin; legacy stored states are not proof of missing history.',
              card.id,
            );
          return;
        }
        const origin = reviewProjectionOrigin(
          events,
          newCard(card.resetAt ?? rows[0]?.reviewedAt ?? card.due),
        );
        const projected = fromSchedulingState(projectReviewEvents(events, origin, config));
        if (
          projected.reps !== card.reps ||
          projected.lastReview?.getTime() !== card.lastReview?.getTime()
        )
          finding(
            'history-counters',
            'error',
            'Canonical event projection disagrees on repetitions or last answer. Includes cancellation, reset and captured nonzero origins; inspect immutable events before any repair.',
            card.id,
          );
        else if (
          ['state', 'stability', 'difficulty', 'lapses', 'learningStep'].some(
            (key) => projected[key as keyof CardStateRow] !== card[key as keyof CardStateRow],
          )
        )
          finding(
            'replay-current-settings',
            'warning',
            'Memory differs under current account settings/algorithm. Historical settings are not persisted, so this is diagnostic evidence only. Due/placedDue are deliberately not compared.',
            card.id,
          );
      } catch {
        unverified(
          'replay-unusable-event',
          'A captured predecessor/event cannot be decoded by current mapping. Inspect bounded event history privately.',
          card.id,
        );
      }
    },
  );
  if ((options.cardId || options.deckId) && !report.coverage['cards']?.scanned) {
    unverified(
      'target-unavailable',
      'Target has no accessible Cards. An empty Deck is valid; confirm the requested scope.',
    );
  }

  // Practice snapshots are historical; do not compare their pool to current Notes.
  await pages<{ id: string; run: unknown; oversized: boolean }>(
    'practice',
    `select id,octet_length(run::text)>65536 as oversized,
      case when octet_length(run::text)<=65536 then run else null end as run
     from practice_runs where user_id=$1 and ($2::uuid is null or id>$2)
       and ($4::uuid is null or false) and ($5::uuid is null or deck_id=$5) order by id limit $3`,
    options.afterPractice,
    (row) => {
      if (row.oversized) {
        unverified(
          'practice-size-limit',
          'Practice snapshot exceeds 64 KiB validation limit.',
          row.id,
        );
        return;
      }
      const parsed = practiceRunSchema.safeParse(row.run);
      if (!parsed.success || !isPracticeRunConsistent(parsed.data))
        finding(
          'practice-shape',
          'warning',
          'Stored Practice snapshot fails maintained schema/consistency validation; stale Note membership alone is valid.',
          row.id,
        );
    },
  );

  const receiptSchemas = {
    rename: renameDeckResultSchema,
    deckCreation: createOfflineDeckResultSchema,
    noteCreate: createOfflineNoteResultSchema,
    noteEdit: editOfflineNoteResultSchema,
  };
  const [oversizedKeys] = await query<{ count: string }>(
    'select count(*)::text as count from sync_receipts where user_id=$1 and octet_length(fingerprint)>200',
    [options.userId],
  );
  if (Number(oversizedKeys?.count ?? 0) > 0) {
    addFinding(
      report,
      options.details,
      'receipt-key-size-limit',
      'info',
      'Receipt keys above 200 bytes were excluded from client pagination. Inspect them confidentially.',
      undefined,
      Number(oversizedKeys?.count),
    );
    report.coverage['verification'] = { scanned: 0, complete: false };
  }
  // Account-level receipts are checked even in a targeted replay. Only known
  // digest/command-UUID cursors may be emitted, never arbitrary stored strings.
  await pages<{ id: string; outcome: Record<string, unknown> | null; oversized: boolean }>(
    'receipts',
    `select fingerprint as id, octet_length(outcome::text)>16384 as oversized,
      case when octet_length(outcome::text)<=16384 then outcome else null end as outcome
     from sync_receipts where user_id=$1 and octet_length(fingerprint)<=200 and ($2::text is null or fingerprint>$2)
       and ($4::uuid is null or true) and ($5::uuid is null or true) order by fingerprint limit $3`,
    options.afterReceipt,
    (row) => {
      if (row.oversized) {
        unverified(
          'receipt-size-limit',
          'Receipt exceeds 16 KiB validation limit; payload is withheld.',
        );
        return;
      }
      const outcome = row.outcome;
      if (!outcome || typeof outcome['clamped'] !== 'boolean') {
        finding(
          'receipt-shape',
          'error',
          'Receipt lacks a boolean clamped outcome. Payload and fingerprint withheld.',
        );
        return;
      }
      for (const [key, validator] of Object.entries(receiptSchemas)) {
        if (!(key in outcome)) continue;
        const wrapper = outcome[key] as { digest?: unknown; result?: unknown } | null;
        const result = validator.safeParse(wrapper?.result);
        if (
          typeof wrapper?.digest !== 'string' ||
          !/^[\da-f]{64}$/.test(wrapper.digest) ||
          !result.success
        )
          finding(
            'receipt-result',
            'error',
            'Persisted delivery result fails its maintained schema/digest shape. Historical result need not equal the current entity.',
          );
        else if (
          'revision' in result.data &&
          BigInt(result.data.revision) > BigInt(report.revision ?? '0')
        )
          finding(
            'receipt-revision',
            'error',
            'Delivery result revision exceeds the account head.',
          );
      }
    },
  );
}

function validSchedule(row: CardStateRow): boolean {
  return (
    (CARD_STATES as readonly string[]).includes(row.state) &&
    row.due instanceof Date &&
    Number.isFinite(row.due.getTime()) &&
    [row.reps, row.lapses, row.learningStep].every(
      (value) => Number.isInteger(value) && value >= 0,
    ) &&
    row.lapses <= row.reps &&
    (row.state === 'new'
      ? row.stability === null &&
        row.difficulty === null &&
        row.lastReview === null &&
        row.reps === 0 &&
        row.lapses === 0 &&
        row.learningStep === 0
      : typeof row.stability === 'number' &&
        Number.isFinite(row.stability) &&
        row.stability > 0 &&
        typeof row.difficulty === 'number' &&
        row.difficulty >= 1 &&
        row.difficulty <= 10 &&
        row.lastReview instanceof Date &&
        Number.isFinite(row.lastReview.getTime()))
  );
}
