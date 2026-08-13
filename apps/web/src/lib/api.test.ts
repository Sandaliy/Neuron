import { describe, expect, it } from 'vitest';

import { ApiFailure, describe as describeFailure } from './api';

/**
 * The api answers with a code and never with a sentence, so this mapping is the
 * only thing standing between a refusal and a blank space on somebody's screen.
 */
describe('describing a failure', () => {
  it('turns a code into the key for that code', () => {
    const failure = new ApiFailure({ code: 'name_taken', status: 409, correlationId: 'abc' });

    expect(describeFailure(failure).key).toBe('error.name_taken');
  });

  it('carries the wait time into a rate limited message', () => {
    const failure = new ApiFailure({
      code: 'rate_limited',
      status: 429,
      correlationId: 'abc',
      retryAfterSeconds: 42,
    });

    expect(describeFailure(failure).values['seconds']).toBe(42);
  });

  it('carries the correlation id, which is the only handle on a server fault', () => {
    const failure = new ApiFailure({
      code: 'internal_error',
      status: 500,
      correlationId: '019ff884-7c84-7000',
    });

    expect(describeFailure(failure).values['correlationId']).toBe('019ff884-7c84-7000');
  });

  it('reads a request that never arrived as the server not answering', () => {
    // The person pulled into a lift, or the deployment restarting. From where
    // they are sitting it is the same event, and it must not surface as
    // "TypeError: Failed to fetch".
    expect(describeFailure(new TypeError('Failed to fetch')).key).toBe('error.service_unavailable');
  });

  it('has a message for a rate limit even when the server named no wait', () => {
    const failure = new ApiFailure({ code: 'rate_limited', status: 429, correlationId: 'abc' });

    // Never `undefined`, because `Wait {seconds} seconds` with nothing in it
    // reads like the app is broken.
    expect(describeFailure(failure).values['seconds']).toBe(60);
  });
});
