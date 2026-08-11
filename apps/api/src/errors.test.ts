import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CardNotFound, DeckCycle, DeckNotFound, UnknownNoteType } from './db/repositories/index.js';
import { ApiError, toApiError } from './errors.js';

/**
 * How a failure becomes an answer.
 *
 * The property under test is not really the mapping. It is that nothing a
 * database says reaches the client: a driver message names constraints and
 * columns, which is useful to us and is a map of the schema to anybody else.
 */

/** What the driver throws, as far as anything here is concerned. */
function databaseError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('toApiError', () => {
  it('leaves an error that already knows what it is alone', () => {
    const original = new ApiError('not_allowed');

    expect(toApiError(original)).toBe(original);
  });

  it('turns a validation failure into the fields that were wrong', () => {
    const schema = z.strictObject({ name: z.string(), count: z.number() });
    const result = schema.safeParse({ name: 4, count: 'many' });
    const api = toApiError(result.success ? new Error('unreachable') : result.error);

    expect(api.code).toBe('invalid_request');
    expect(api.status).toBe(400);
    expect(api.details?.fields?.map((field) => field.path).sort()).toEqual(['count', 'name']);
  });

  it('does not put the rejected value in the answer', () => {
    const schema = z.strictObject({ password: z.string().min(20) });
    const result = schema.safeParse({ password: 'hunter2' });
    const api = toApiError(result.success ? new Error('unreachable') : result.error);

    expect(JSON.stringify(api.details)).not.toContain('hunter2');
  });

  it('maps the errors the repository layer raises', () => {
    expect(toApiError(new DeckNotFound('x')).code).toBe('not_found');
    expect(toApiError(new CardNotFound('x')).code).toBe('not_found');
    expect(toApiError(new DeckCycle()).code).toBe('deck_cycle');
    expect(toApiError(new UnknownNoteType('x')).code).toBe('unknown_note_type');
  });

  it('turns a duplicate name into something a person can be told about', () => {
    const api = toApiError(
      databaseError(
        '23505',
        'duplicate key value violates unique constraint "decks_sibling_name_key"',
      ),
    );

    expect(api.code).toBe('name_taken');
    expect(api.status).toBe(409);
  });

  it('reads an attempt to rewrite the review log as a refusal', () => {
    const api = toApiError(
      databaseError('23001', 'the review log is append only, DELETE is not allowed on reviews'),
    );

    expect(api.code).toBe('not_allowed');
  });

  it('reads a missing privilege as a row that is not there', () => {
    // From the outside those are the same thing, and they should be: saying
    // "you may not read that" confirms that it exists.
    expect(toApiError(databaseError('42501', 'permission denied for table account')).code).toBe(
      'not_found',
    );
  });

  it('finds the database code even when the query builder wrapped it', () => {
    // Drizzle raises an error of its own with the driver's underneath. Reading
    // only the outermost one turns every duplicate name into an internal error.
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: databaseError('23505', 'duplicate key value violates unique constraint'),
    });

    expect(toApiError(wrapped).code).toBe('name_taken');
  });

  it('does not mistake a Node error code for a SQLSTATE', () => {
    expect(toApiError(databaseError('ECONNREFUSED', 'connect ECONNREFUSED')).code).toBe(
      'internal_error',
    );
  });

  it('calls anything it does not understand an internal error', () => {
    const api = toApiError(new TypeError('cannot read properties of undefined'));

    expect(api.code).toBe('internal_error');
    expect(api.status).toBe(500);
  });

  it('keeps the detail on the error rather than in the code', () => {
    // The cause is what gets written to the server log against the correlation
    // id. It is deliberately not part of what the client is told.
    const cause = databaseError('23505', 'duplicate key value violates unique constraint "x"');
    const api = toApiError(cause);

    expect(api.cause).toBe(cause);
    expect(api.message).toBe('name_taken');
  });
});
