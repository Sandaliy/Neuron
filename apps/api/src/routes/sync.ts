import { Hono } from 'hono';

import { pullSyncSchema, pushSyncSchema } from '@neuron/shared';
import type { SyncChange } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { CardNotFound, wordToRating } from '../db/repositories/index.js';
import { readBody, readQuery } from '../validation.js';

import type { RequestBindings } from '../context.js';
import type { IncomingChange, SyncRow } from '../db/repositories/index.js';

/**
 * Sync: what changed, and what I changed.
 *
 * Pulling is one ordered stream keyed on the user's revision counter, so a
 * download cut off halfway can be resumed from the last number that arrived
 * whole. Pushing is one transaction: either the whole batch lands or none of it
 * does, because a client that had half its changes accepted has no way to work
 * out which half.
 */

/** How much of the stream to send when the client does not say. */
const DEFAULT_PULL_LIMIT = 200;

/** Rows go out with their dates as strings, like everywhere else. */
function presentRow(change: SyncRow) {
  const row: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(change.row)) {
    // user_id is on every row in the database and on nothing that leaves it. A
    // client that had to be told whose data it was reading would be a client
    // that could ask for somebody else's.
    if (key === 'userId' || key === 'deletedWithNote') {
      continue;
    }

    row[key] = value instanceof Date ? value.toISOString() : value;
  }

  return { entity: change.entity, id: change.id, rev: change.rev, deleted: change.deleted, row };
}

/** Turns a validated change into what the repository takes. */
function toIncoming(change: SyncChange): IncomingChange {
  return {
    entity: change.entity,
    id: change.id,
    updatedAt: change.updatedAt,
    deleted: change.deleted,
    data: change.data as Record<string, unknown> | undefined,
  };
}

export function syncRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const query = readQuery(context, pullSyncSchema);
    const result = await repositoriesOf(context).sync.pull(
      query.since ?? 0,
      query.limit ?? DEFAULT_PULL_LIMIT,
    );

    return context.json({
      since: result.since,
      revision: result.revision,
      hasMore: result.hasMore,
      changes: result.changes.map(presentRow),
    });
  });

  /**
   * A batch of client changes, applied as one unit.
   *
   * Entities merge by last write wins on `updated_at`, and the version that
   * loses is written to the conflict log rather than dropped, so nothing is
   * destroyed to produce the answer. Reviews take the other path: they are
   * appended, they are idempotent by id, and they cannot conflict, because the
   * same id arriving twice is the same fact arriving twice.
   *
   * Both happen inside one transaction. A review that lands while the deck it
   * belongs to is rolled back would be a review of a card that is not there.
   */
  routes.post('/', async (context) => {
    const body = await readBody(context, pushSyncSchema);
    const repositories = repositoriesOf(context);
    const now = new Date();

    const outcome = await repositories.transaction(async (inner) => {
      const pushed = await inner.sync.push(body.changes.map(toIncoming), now);

      let applied = 0;
      let duplicates = 0;
      const clamped = [...pushed.clamped];

      for (const review of body.reviews) {
        const inFuture = review.reviewedAt.getTime() > now.getTime();
        const reviewedAt = inFuture ? now : review.reviewedAt;

        if (inFuture) {
          clamped.push(review.id);
        }

        try {
          const recorded = await inner.reviews.record({
            id: review.id,
            cardId: review.cardId,
            rating: wordToRating(review.rating),
            now: reviewedAt,
            durationMs: review.durationMs,
          });

          if (recorded.applied) {
            applied += 1;
          } else {
            duplicates += 1;
          }
        } catch (error) {
          if (error instanceof CardNotFound) {
            // The card was deleted on another device. The answer has nowhere
            // to land and is not worth failing the batch over.
            continue;
          }

          throw error;
        }
      }

      return {
        applied: pushed.applied,
        conflicts: pushed.conflicts,
        clamped,
        reviews: { applied, duplicates },
        revision: await inner.sync.revision(),
        noteRestorations: pushed.noteRestorations,
      };
    });

    return context.json(outcome);
  });

  return routes;
}
