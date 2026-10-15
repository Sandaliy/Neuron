import {
  cardSchema,
  reviewResultSchema,
  submitReviewSchema,
  undoReviewSchema,
  undoReviewResultSchema,
} from '@neuron/shared';
import type { Card, ReviewResult } from '@neuron/shared';

export type ReviewIntent =
  | {
      type: 'answer';
      payload: {
        id: string;
        cardId: string;
        rating: 'again' | 'hard' | 'good' | 'easy';
        reviewedAt: string;
        durationMs: number;
      };
    }
  | { type: 'undo'; payload: { id: string; reviewId: string; reviewedAt: string } };
export function validateEvent(event: ReviewIntent) {
  if (event.type === 'answer') submitReviewSchema.parse(event.payload);
  else if (event.type === 'undo') undoReviewSchema.parse(event.payload);
  else throw new Error('review_invalid_outbox');
}
// Keep timestamps as their original JSON strings, including after validation.
export interface PendingReview {
  kind: 'review-event';
  operationId: string;
  accountId: string;
  sessionId: string;
  sequence: number;
  predecessor: string | null;
  event: ReviewIntent;
  before: Card;
  state: 'pending' | 'rejected' | 'synchronized' | 'archived';
  failure?: string | undefined;
  acknowledgement?:
    ReviewResult | { id: string; reviewId: string; cancellationId: string; card: Card };
}
export function validateReviewIntent(value: unknown, accountId: string): PendingReview {
  const entry = value as PendingReview;
  if (
    !entry ||
    entry.kind !== 'review-event' ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence < 1 ||
    !['pending', 'rejected', 'synchronized', 'archived'].includes(entry.state)
  )
    throw new Error('review_invalid_outbox');
  cardSchema.parse(entry.before);
  validateEvent(entry.event);
  undoReviewSchema.parse({ id: entry.sessionId, reviewId: entry.operationId });
  if (entry.predecessor)
    undoReviewSchema.parse({ id: entry.predecessor, reviewId: entry.operationId });
  if (entry.acknowledgement)
    (entry.event.type === 'answer' ? reviewResultSchema : undoReviewResultSchema).parse(
      entry.acknowledgement,
    );
  const parsed = entry;
  if (
    parsed.accountId !== accountId ||
    parsed.operationId !== parsed.event.payload.id ||
    (parsed.event.type === 'answer' && parsed.event.payload.cardId !== parsed.before.id) ||
    (parsed.state === 'synchronized' && !parsed.acknowledgement) ||
    (parsed.acknowledgement &&
      (parsed.acknowledgement.id !== parsed.operationId ||
        parsed.acknowledgement.card.id !== parsed.before.id ||
        (parsed.event.type === 'answer' &&
          (!('cardId' in parsed.acknowledgement) ||
            parsed.acknowledgement.cardId !== parsed.before.id)) ||
        (parsed.event.type === 'undo' &&
          (!('reviewId' in parsed.acknowledgement) ||
            parsed.acknowledgement.reviewId !== parsed.event.payload.reviewId))))
  )
    throw new Error('review_invalid_outbox');
  return entry;
}
