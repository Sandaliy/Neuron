import { Hono } from 'hono';

import { submitReviewBatchSchema, submitReviewSchema } from '@neuron/shared';
import type { SubmitReviewBody } from '@neuron/shared';

import { repositoriesOf } from '../context.js';
import { CardNotFound, wordToRating } from '../db/repositories/index.js';
import { serialiseCard } from '../serialise.js';
import { readBody } from '../validation.js';

import type { RequestBindings } from '../context.js';
import type { CardRow, Repositories } from '../db/repositories/index.js';

/**
 * Answering a card. The hot path, and the one endpoint with a security
 * argument rather than a correctness one.
 *
 * The client works out the new card state on the device. It has to: that is
 * what makes the app work with no network and what makes the buttons feel
 * instant. But it means a modified client could send whatever state it liked,
 * and a server that stored it would let anyone set a card's stability to a
 * million and never see it again.
 *
 * So the server does the work again. It loads the card, runs the same scheduler
 * from packages/core, and stores its own answer. What the client computed is
 * compared and discarded. When the two disagree past rounding, the response
 * says so and the client fetches that card again.
 *
 * Retrying is harmless. The id comes from the client, and inserting the same id
 * twice succeeds and changes nothing. This is not hypothetical: a phone on the
 * underground sends an answer, loses the connection before the reply, and sends
 * again. Without the id, one tap becomes two reviews and the card's schedule
 * quietly moves.
 */

/**
 * How far apart the two computations may be before the client is told to
 * resync.
 *
 * Both ends run the same double precision arithmetic in the same order, so they
 * should agree exactly. The tolerance is for a client that rounded on the way
 * into its own storage, not for a difference of opinion.
 */
const NUMBER_TOLERANCE = 1e-6;

/** A second, for comparing due dates, which are whole minutes at their finest. */
const DUE_TOLERANCE_MS = 1000;

/**
 * How far into the future a device's clock may claim to be.
 *
 * A phone answering a card cannot have done it later than now. Anything past
 * this is a clock that is wrong, and believing it would place the card by a
 * date that never happens.
 */
const MAX_FUTURE_MS = 2 * 60 * 1000;

/** Whether two numbers agree closely enough to be the same answer. */
function agrees(mine: number | null, theirs: number | null | undefined): boolean {
  if (mine === null || theirs === null || theirs === undefined) {
    return mine === (theirs ?? null);
  }

  return Math.abs(mine - theirs) <= NUMBER_TOLERANCE * Math.max(1, Math.abs(mine));
}

/**
 * Whether the client's own computation matches what the server worked out.
 *
 * @param card the card as the server left it
 * @param computed what the client said it would be
 * @returns true when the client should fetch this card again
 */
function shouldResync(card: CardRow, computed: SubmitReviewBody['computed']): boolean {
  if (computed === undefined) {
    return false;
  }

  return (
    card.state !== computed.state ||
    !agrees(card.stability, computed.stability) ||
    !agrees(card.difficulty, computed.difficulty) ||
    Math.abs(card.due.getTime() - computed.due.getTime()) > DUE_TOLERANCE_MS
  );
}

interface Applied {
  readonly id: string;
  readonly cardId: string;
  readonly card: CardRow;
  readonly applied: boolean;
  readonly resync: boolean;
  readonly clamped: boolean;
}

/**
 * Records one answer, with the client's timestamp checked rather than trusted.
 *
 * @param repositories the repositories, inside a transaction
 * @param body the answer as it arrived
 * @param now the server's clock
 * @returns what was written and what the client should do about it
 */
async function apply(
  repositories: Repositories,
  body: SubmitReviewBody,
  now: Date,
): Promise<Applied> {
  const clamped = body.reviewedAt.getTime() > now.getTime() + MAX_FUTURE_MS;
  const reviewedAt = clamped ? now : body.reviewedAt;

  const outcome = await repositories.reviews.record({
    id: body.id,
    cardId: body.cardId,
    rating: wordToRating(body.rating),
    now: reviewedAt,
    durationMs: body.durationMs,
  });

  return {
    id: body.id,
    cardId: body.cardId,
    card: outcome.card,
    applied: outcome.applied,
    resync: shouldResync(outcome.card, body.computed),
    clamped,
  };
}

/** Turns one applied answer into what goes back over the wire. */
function present(result: Applied) {
  return {
    id: result.id,
    cardId: result.cardId,
    card: serialiseCard(result.card),
    applied: result.applied,
    resync: result.resync,
    clamped: result.clamped,
  };
}

export function reviewRoutes(): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.post('/', async (context) => {
    const body = await readBody(context, submitReviewSchema);
    const repositories = repositoriesOf(context);
    const result = await apply(repositories, body, new Date());

    return context.json(present(result));
  });

  /**
   * A phone coming back from a session with no network sends the lot.
   *
   * One transaction, so the batch either lands or does not. An answer whose
   * card has since been deleted on another device is reported and skipped
   * rather than failing everything: a device that has been away for a week
   * should not be permanently unable to sync because one of two hundred
   * answers points at something that has gone.
   *
   * Sorted by the time the answers were given, because two answers to the same
   * card have to be replayed in the order they happened or the second one is
   * computed from a state that never existed.
   */
  routes.post('/batch', async (context) => {
    const body = await readBody(context, submitReviewBatchSchema);
    const repositories = repositoriesOf(context);
    const now = new Date();

    const ordered = [...body.reviews].sort(
      (left, right) => left.reviewedAt.getTime() - right.reviewedAt.getTime(),
    );

    const outcome = await repositories.transaction(async (inner) => {
      const results: Applied[] = [];
      const skipped: { id: string; cardId: string }[] = [];

      for (const review of ordered) {
        try {
          results.push(await apply(inner, review, now));
        } catch (error) {
          if (error instanceof CardNotFound) {
            skipped.push({ id: review.id, cardId: review.cardId });

            continue;
          }

          throw error;
        }
      }

      return { results, skipped, revision: await inner.sync.revision() };
    });

    return context.json({
      results: outcome.results.map(present),
      skipped: outcome.skipped,
      revision: outcome.revision,
    });
  });

  return routes;
}

export { apply as applyReview };
