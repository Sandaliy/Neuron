import { ApiError } from './errors.js';

import type { Context } from 'hono';
import type { z } from 'zod';

/**
 * Reading a request, with nothing taken on trust.
 *
 * Every body, every query string and every path parameter goes through a schema
 * from packages/shared before a handler sees it. The schemas are strict, so a
 * field the server does not know about is a refused request rather than a
 * silently dropped one: a client sending `parentID` for `parentId` finds out at
 * once instead of wondering for a week why nothing moves.
 *
 * The failure comes back as a list of paths and Zod's own codes, never as a
 * message quoting what somebody typed. A validation error that echoes the input
 * is a validation error that puts a person's cards in a log.
 */

/**
 * Turns a Zod failure into the api's error.
 *
 * @param error the failure
 * @returns the error to throw
 */
function invalid(error: z.ZodError): ApiError {
  return new ApiError('invalid_request', {
    details: {
      fields: error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.') || '(body)',
        code: issue.code,
      })),
    },
    cause: error,
  });
}

/**
 * Parses the JSON body against a schema.
 *
 * A body that is not JSON at all fails the same way a body with a bad field
 * does, because from the caller's side they are the same mistake.
 *
 * @param context the request
 * @param schema what the body has to be
 * @returns the parsed body
 */
export async function readBody<S extends z.ZodType>(
  context: Context,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;

  try {
    raw = await context.req.json();
  } catch (error) {
    throw new ApiError('invalid_request', {
      details: { fields: [{ path: '(body)', code: 'invalid_json' }] },
      cause: error,
    });
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    throw invalid(result.error);
  }

  return result.data;
}

/**
 * Parses the query string against a schema.
 *
 * Repeated parameters collapse to the first value. Nothing in this api takes a
 * list in the query, so a second copy of one is a mistake rather than a
 * meaning, and picking the first is the least surprising way to read it.
 *
 * @param context the request
 * @param schema what the query has to be
 * @returns the parsed query
 */
export function readQuery<S extends z.ZodType>(context: Context, schema: S): z.output<S> {
  const result = schema.safeParse(context.req.query());

  if (!result.success) {
    throw invalid(result.error);
  }

  return result.data;
}

/**
 * Parses the path parameters against a schema.
 *
 * @param context the request
 * @param schema what the parameters have to be
 * @returns the parsed parameters
 */
export function readParams<S extends z.ZodType>(context: Context, schema: S): z.output<S> {
  const result = schema.safeParse(context.req.param());

  if (!result.success) {
    throw invalid(result.error);
  }

  return result.data;
}
