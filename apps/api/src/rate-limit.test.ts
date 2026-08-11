import { beforeAll, describe, expect, it } from 'vitest';

import { appClient, testDatabase } from './db/testing/database.js';
import { createRateLimiter, rateLimitKey } from './rate-limit.js';

import type { RateLimiter, RateLimitRule } from './rate-limit.js';

/**
 * The limiter, against the database it actually counts in.
 *
 * Testing this against a fake would prove that the fake counts, which is not a
 * fact about anything. The whole reason the counters moved out of memory is
 * that memory is per instance on a serverless platform, and the property worth
 * checking is that two callers sharing a database share a count.
 */

const database = testDatabase();

/** Small numbers, so a test does not have to make twenty requests to see one refusal. */
const rule: RateLimitRule = {
  bucket: 'test',
  limit: 3,
  windowSeconds: 60,
  penaltySeconds: 10,
  maxPenaltySeconds: 120,
};

describe.skipIf(!database)('the rate limiter', () => {
  let limiter: RateLimiter;

  beforeAll(() => {
    if (database) {
      limiter = createRateLimiter(appClient(database));
    }
  });

  /** A fresh identifier per test, so one test cannot spend another's attempts. */
  function subject(name: string): string {
    return `${name}-${Date.now()}-${Math.random()}`;
  }

  it('allows attempts up to the limit and counts them down', async () => {
    const who = subject('under');
    const now = new Date();

    expect(await limiter.take(rule, who, now)).toMatchObject({ allowed: true, remaining: 2 });
    expect(await limiter.take(rule, who, now)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await limiter.take(rule, who, now)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it('refuses the attempt after the limit, with a wait rather than a wall', async () => {
    const who = subject('over');
    const now = new Date();

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      await limiter.take(rule, who, now);
    }

    const decision = await limiter.take(rule, who, now);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(rule.penaltySeconds);
  });

  it('makes the wait longer every window that goes over', async () => {
    /**
     * A typo costs seconds and a script costs the afternoon.
     *
     * The wait doubles with each window that went over the limit, so somebody
     * who mistyped their password twice is barely inconvenienced and somebody
     * working through a list is stopped.
     */
    const who = subject('escalating');
    const start = new Date();

    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await limiter.take(rule, who, start);
    }

    const secondWindow = new Date(start.getTime() + rule.windowSeconds * 1000 + 1000);

    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await limiter.take(rule, who, secondWindow);
    }

    const decision = await limiter.take(rule, who, secondWindow);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(rule.penaltySeconds);
  });

  it('never lets the wait grow past the cap', async () => {
    const who = subject('capped');
    let at = new Date();

    for (let window = 0; window < 12; window += 1) {
      for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
        await limiter.take(rule, who, at);
      }

      at = new Date(at.getTime() + rule.windowSeconds * 1000 + 1000);
    }

    const decision = await limiter.take(rule, who, at);

    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(rule.maxPenaltySeconds);
  });

  it('opens up again once the window has passed without going over', async () => {
    const who = subject('recovering');
    const start = new Date();

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      await limiter.take(rule, who, start);
    }

    const later = new Date(start.getTime() + rule.windowSeconds * 1000 + 1000);

    expect(await limiter.take(rule, who, later)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('keeps two identifiers apart', async () => {
    const one = subject('first');
    const two = subject('second');
    const now = new Date();

    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await limiter.take(rule, one, now);
    }

    expect((await limiter.take(rule, two, now)).allowed).toBe(true);
  });

  it('keeps two rules over the same identifier apart', async () => {
    const who = subject('shared');
    const other: RateLimitRule = { ...rule, bucket: 'test-other' };
    const now = new Date();

    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await limiter.take(rule, who, now);
    }

    expect((await limiter.take(other, who, now)).allowed).toBe(true);
  });

  it('counts the same across two callers, which is the whole reason it moved', async () => {
    // Two limiters, two connections, one count. In memory this was two counts,
    // and an attacker spread across serverless instances got as many attempts
    // as there happened to be instances.
    if (!database) {
      return;
    }

    const other = createRateLimiter(appClient(database));
    const who = subject('shared-store');
    const now = new Date();

    await limiter.take(rule, who, now);
    await other.take(rule, who, now);
    await limiter.take(rule, who, now);

    expect((await other.take(rule, who, now)).allowed).toBe(false);
  });
});

describe('the stored key', () => {
  it('never contains the address it is about', () => {
    // A copy of the table says how often something was tried and nothing about
    // who tried it.
    const key = rateLimitKey(rule, 'someone@example.test');

    expect(key).not.toContain('someone');
    expect(key).not.toContain('example.test');
    expect(key.startsWith('test:')).toBe(true);
  });

  it('does not care about the case of an address', () => {
    expect(rateLimitKey(rule, 'Someone@Example.test')).toBe(
      rateLimitKey(rule, 'someone@example.test'),
    );
  });
});
