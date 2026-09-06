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
  /** The original parent deck or note must be restored first. */
  'restore_dependency',
  /** The note type named on a write does not exist. */
  'unknown_note_type',
  /** The fields do not match the note type they claim to be. */
  'invalid_note_fields',
  /** Too many attempts. `retryAfterSeconds` says how long to wait. */
  'rate_limited',
  /** Registration is closed. Says nothing about the address that was tried. */
  'registration_closed',
  /** The password is too short, too long, or one of the ones attacked first. */
  'weak_password',
  /** That address already has an account. */
  'email_taken',
  /** The email and password given do not go together, or there is no account. */
  'invalid_credentials',
  /** The recovery code was wrong, or has already been spent. */
  'invalid_recovery_code',
  /** No recovery codes are left. Only the admin script can help now. */
  'no_recovery_codes',
  /** This session may only set a new password until it has done so. */
  'password_change_required',
  /** The account exists but the address has not been confirmed. */
  'email_not_verified',
  /** Signing in got as far as the password. The second factor is still owed. */
  'two_factor_required',
  /** The authenticator code was wrong. */
  'invalid_two_factor_code',
  /** That authenticator code was already used once. */
  'two_factor_code_reused',
  /** The second factor is not set up, or is set up already. */
  'two_factor_unavailable',
  /** The verification or reset link is wrong, spent, or too old. */
  'invalid_token',
  /** A card cannot take another direction, or the direction is already there. */
  'direction_unavailable',
  /** The edit would remove cards that have been answered, and nobody agreed. */
  'cards_would_be_lost',
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
  /** How many cards an edit would remove, and how many answers with them. */
  cards: z.number().int().min(0).optional(),
  reviews: z.number().int().min(0).optional(),
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
  restore_dependency: 409,
  unknown_note_type: 400,
  invalid_note_fields: 400,
  rate_limited: 429,
  registration_closed: 403,
  weak_password: 400,
  email_taken: 409,
  // 401, not 404. Whether the address has an account is exactly what a list
  // attack is trying to learn, and one answer for both cases is what stops it.
  invalid_credentials: 401,
  invalid_recovery_code: 401,
  no_recovery_codes: 403,
  password_change_required: 403,
  email_not_verified: 403,
  two_factor_required: 401,
  invalid_two_factor_code: 401,
  two_factor_code_reused: 401,
  two_factor_unavailable: 409,
  invalid_token: 400,
  direction_unavailable: 409,
  cards_would_be_lost: 409,
  sync_rejected: 409,
  service_unavailable: 503,
  internal_error: 500,
};
