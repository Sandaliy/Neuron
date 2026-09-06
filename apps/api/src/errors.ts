import { ZodError } from 'zod';

import { API_ERROR_STATUS, uuidV7 } from '@neuron/shared';
import type { ApiErrorCode } from '@neuron/shared';

import { CardNotFound, DeckCycle, DeckNotFound, UnknownNoteType } from './db/repositories/index.js';
import { RestoreDependency } from './db/repositories/restoration.js';

import type { Context } from 'hono';

/**
 * One error shape, one place that decides it.
 *
 * Every failure leaves the api as `{ error: { code, status, correlationId } }`.
 * The code is a key the client turns into English or Russian; there is no
 * English sentence anywhere in this file for a person to read. What actually
 * went wrong is written to the server log against the correlation id, and the
 * id goes back to the client so a report of "it said something went wrong" can
 * be traced to one request.
 *
 * Nothing leaks. Not a stack trace, not a driver message, not a column name. A
 * database error that says which constraint failed is useful to us and is a map
 * of the schema to anyone else, so it is turned into a code here and its text
 * stays on the server.
 */

/** What extra facts an error may carry back. All of them safe to show. */
export interface ApiErrorDetails {
  readonly fields?: readonly { readonly path: string; readonly code: string }[];
  readonly retryAfterSeconds?: number;
  /** How many cards an edit would remove, and how many answers with them. */
  readonly cards?: number;
  readonly reviews?: number;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetails | undefined;

  constructor(
    code: ApiErrorCode,
    options: { readonly details?: ApiErrorDetails; readonly cause?: unknown } = {},
  ) {
    // The message is for the log, never for the client. It says the code so a
    // line in the log is readable on its own.
    super(code, options.cause === undefined ? undefined : { cause: options.cause });

    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = options.details;
  }
}

/** The Postgres error codes worth telling apart. */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Reads the SQLSTATE off whatever was thrown.
 *
 * Down the chain of causes rather than off the top, because Drizzle wraps what
 * the driver raised in an error of its own. Reading only the outermost one
 * turns every duplicate name into an internal error, which is both the wrong
 * status and a line in the log that says nothing.
 *
 * @param error the thrown value
 * @returns the five character code, or undefined when nothing in the chain is a
 *   database error
 */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;

  // Bounded, because a cause that points at itself would otherwise spin here.
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current) {
      const code = (current as { code: unknown }).code;

      // Postgres uses five characters. Node uses this field for its own codes,
      // such as ECONNREFUSED, and those are not what this is asking about.
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
        return code;
      }
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/**
 * Turns a Zod failure into the list of fields that were wrong.
 *
 * The path and Zod's own code, never the value that was rejected. A message
 * quoting what somebody typed is a message that can end up in a log.
 *
 * @param error the validation failure
 * @returns one entry per bad field
 */
function fieldsOf(error: ZodError): { path: string; code: string }[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join('.') || '(body)',
    code: issue.code,
  }));
}

/**
 * Works out which code answers a thrown value.
 *
 * The repository layer throws named errors for the cases a person can cause,
 * and the database throws SQLSTATEs for the ones it catches itself. Everything
 * else is an internal error, which is the honest answer: if it were understood
 * it would be on this list.
 *
 * @param error whatever was thrown
 * @returns the error to answer with
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ApiError('invalid_request', { details: { fields: fieldsOf(error) }, cause: error });
  }

  if (error instanceof DeckNotFound || error instanceof CardNotFound) {
    return new ApiError('not_found', { cause: error });
  }

  if (error instanceof DeckCycle) {
    return new ApiError('deck_cycle', { cause: error });
  }

  if (error instanceof RestoreDependency) {
    return new ApiError('restore_dependency', { cause: error });
  }

  if (error instanceof UnknownNoteType) {
    return new ApiError('unknown_note_type', { cause: error });
  }

  switch (sqlState(error)) {
    case UNIQUE_VIOLATION:
      return new ApiError('name_taken', { cause: error });

    case CHECK_VIOLATION:
    case FOREIGN_KEY_VIOLATION:
      return new ApiError('invalid_request', { cause: error });

    case RESTRICT_VIOLATION:
      // The append only trigger on the review log. Reaching this means
      // something tried to rewrite history, which is worth a loud line in the
      // log and a flat refusal to the caller.
      return new ApiError('not_allowed', { cause: error });

    case INSUFFICIENT_PRIVILEGE:
      // A grant the application role does not have. From the outside this is
      // indistinguishable from the row not being there, and it should be.
      return new ApiError('not_found', { cause: error });

    default:
      return new ApiError('internal_error', { cause: error });
  }
}

/**
 * What goes in the log when a request fails.
 *
 * The request body is not here, and neither is the user id. A failing write of
 * a card would otherwise put the person's cards in the log, and a log is the
 * easiest place in a system to read.
 *
 * @param correlationId the id given back to the client
 * @param error the error, already classified
 * @param context the request, for the method and path
 */
function record(correlationId: string, error: ApiError, context: Context): void {
  const cause = error.cause;
  const detail =
    cause instanceof Error
      ? (cause.stack ?? cause.message)
      : cause === undefined
        ? ''
        : String(cause);

  const line = [
    `[${correlationId}]`,
    `${context.req.method} ${new URL(context.req.url).pathname}`,
    `-> ${error.status} ${error.code}`,
  ].join(' ');

  // Only the ones nobody expected get the full detail. A 404 printing a stack
  // trace on every mistyped url makes the log useless for finding the 500s.
  if (error.status >= 500) {
    console.error(`${line}\n${detail}`);

    return;
  }

  console.warn(line);
}

/**
 * Answers a failed request.
 *
 * Registered as Hono's error handler, so a route that throws needs no try
 * block of its own and cannot answer in a shape of its own invention.
 *
 * @param error whatever the route threw
 * @param context the request
 * @returns the response
 */
export function respondWithError(error: unknown, context: Context): Response {
  const api = toApiError(error);
  const correlationId = uuidV7();

  record(correlationId, api, context);

  if (api.code === 'rate_limited' && api.details?.retryAfterSeconds !== undefined) {
    context.header('retry-after', String(api.details.retryAfterSeconds));
  }

  return context.json(
    {
      error: {
        code: api.code,
        status: api.status,
        correlationId,
        ...(api.details === undefined ? {} : { details: api.details }),
      },
    },
    api.status as 400,
  );
}
