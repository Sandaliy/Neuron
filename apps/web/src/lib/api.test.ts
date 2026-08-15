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

  it('tells a request that never arrived from a server that refused', () => {
    // The person pulled into a lift, or a captive portal in the way. Telling
    // this apart from the server answering badly is what decides whether they
    // check their connection or wait for somebody else, and it must not
    // surface as "TypeError: Failed to fetch" either way.
    const unreachable = new ApiFailure({
      code: 'network_unreachable',
      status: 0,
      correlationId: 'no-response',
    });

    expect(describeFailure(unreachable).key).toBe('error.network_unreachable');
    expect(describeFailure(unreachable).key).not.toBe(
      describeFailure(
        new ApiFailure({ code: 'service_unavailable', status: 503, correlationId: 'abc' }),
      ).key,
    );
  });

  it('calls a failure nobody predicted unexpected, rather than blaming the server', () => {
    // Something threw on this side: a component, a parser, a bug. Nothing was
    // sent, so there is no id to quote and it must not claim there is.
    const described = describeFailure(new TypeError('Cannot read properties of undefined'));

    expect(described.key).toBe('error.unexpected');
    expect(described.values['correlationId']).toBeUndefined();
  });

  it('keeps the address refusal apart from every other 403', () => {
    // The failure this file was rewritten for. A page opened at an address the
    // api does not trust used to arrive as "You cannot do that", which sent
    // the reader to check a password that was never looked at.
    const refused = new ApiFailure({
      code: 'untrusted_origin',
      status: 403,
      correlationId: 'abc',
    });

    expect(describeFailure(refused).key).toBe('error.untrusted_origin');
    expect(describeFailure(refused).key).not.toBe('error.not_allowed');
  });

  it('has a message for a rate limit even when the server named no wait', () => {
    const failure = new ApiFailure({ code: 'rate_limited', status: 429, correlationId: 'abc' });

    // Never `undefined`, because `Wait {seconds} seconds` with nothing in it
    // reads like the app is broken.
    expect(describeFailure(failure).values['seconds']).toBe(60);
  });
});
