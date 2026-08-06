import { z } from 'zod';

/**
 * The four answers a review can end with. They are stored as words rather than
 * numbers so that a row in the review log stays readable on its own.
 */
export const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

export const ratingSchema = z.enum(RATINGS);

export type Rating = z.infer<typeof ratingSchema>;
