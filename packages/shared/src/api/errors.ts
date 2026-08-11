import { z } from 'zod';

/**
 * One error shape for the whole api.
 *
 * The server never sends a sentence. It sends a code, and the client turns that
 * code into English or Russian. An English string baked into a route handler is
 * a string that can only ever be shown to half the people using this, and it is
 * the kind of thing nobody notices until the interface is already built around
 * it.
 *
 * Nothing here carries a stack trace, a SQL message or a column name. What went
 * wrong in detail is written to the server log against `correlationId`, and the
 * client gets that id so a report can be traced back to the exact request.
 */

/**
 * Every code the api can answer with.
 *
 * A closed list on purpose: the client has a translation for each of these, and
 * a code invented in a route handler would reach a person as a blank space.
 */
export const API_ERROR_CODES = [
  /** No session, or one that has expired. */
  'not_authenticated',
  /** Signed in, but not allowed to do this. */
  'not_allowed',
  /** The thing asked for is not there, or belongs to somebody else. */
  'not_found',
  /** The request body or query did not match its schema. */
  'invalid_request',
  /** A name that has to be unique among its siblings already exists. */
  'name_taken',
  /** A deck was asked to be moved inside itself. */
  'deck_cycle',
  /** The note type named on a write does not exist. */
  'unknown_note_type',
  /** The fields do not match the note type they claim to be. */
  'invalid_note_fields',
  /** Too many attempts. `retryAfterSeconds` says how long to wait. */
  'rate_limited',
  /** A card cannot take another direction, or the direction is already there. */
  'direction_unavailable',
  /** A sync batch was rejected as a whole. */
  'sync_rejected',
  /** The database did not answer. */
  'service_unavailable',
  /** Everything that has no better name. Always logged in full server side. */
  'internal_error',
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * Extra facts about an error, safe to show.
 *
 * Only values the client can act on or put into a sentence: which field was
 * wrong, how long to wait. Never anything read out of the database and never
 * anything a person typed into another account.
 */
export const apiErrorDetailsSchema = z.object({
  /** Which fields failed validation, as dotted paths into the body. */
  fields: z.array(z.strictObject({ path: z.string(), code: z.string() })).optional(),
  /** How long to wait, for a rate limited request. */
  retryAfterSeconds: z.number().int().min(0).optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    status: z.number().int().min(400).max(599),
    /** Find this in the server log to see what actually happened. */
    correlationId: z.string(),
    details: apiErrorDetailsSchema.optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** The status each code is answered with, so both ends agree on one mapping. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  not_authenticated: 401,
  not_allowed: 403,
  not_found: 404,
  invalid_request: 400,
  name_taken: 409,
  deck_cycle: 409,
  unknown_note_type: 400,
  invalid_note_fields: 400,
  rate_limited: 429,
  direction_unavailable: 409,
  sync_rejected: 409,
  service_unavailable: 503,
  internal_error: 500,
};
