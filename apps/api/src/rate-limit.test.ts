import { describe, expect, it } from 'vitest';

import { createInMemoryRateLimiter } from './rate-limit.js';

const options = { limit: 3, windowMs: 60_000 };

describe('createInMemoryRateLimiter', () => {
  it('allows attempts up to the limit', () => {
    const limiter = createInMemoryRateLimiter(options);

    expect(limiter.take('a', 0).allowed).toBe(true);
    expect(limiter.take('a', 0).allowed).toBe(true);
    expect(limiter.take('a', 0).allowed).toBe(true);
  });

  it('blocks the attempt after the limit', () => {
    const limiter = createInMemoryRateLimiter(options);

    for (let attempt = 0; attempt < options.limit; attempt += 1) {
      limiter.take('a', 0);
    }

    const decision = limiter.take('a', 0);

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBe(60);
  });

  it('counts down the attempts left', () => {
    const limiter = createInMemoryRateLimiter(options);

    expect(limiter.take('a', 0).remaining).toBe(2);
    expect(limiter.take('a', 0).remaining).toBe(1);
    expect(limiter.take('a', 0).remaining).toBe(0);
  });

  it('keeps keys apart', () => {
    const limiter = createInMemoryRateLimiter(options);

    for (let attempt = 0; attempt <= options.limit; attempt += 1) {
      limiter.take('a', 0);
    }

    expect(limiter.take('b', 0).allowed).toBe(true);
  });

  it('opens up again once the window has passed', () => {
    const limiter = createInMemoryRateLimiter(options);

    for (let attempt = 0; attempt <= options.limit; attempt += 1) {
      limiter.take('a', 0);
    }

    expect(limiter.take('a', 0).allowed).toBe(false);
    expect(limiter.take('a', options.windowMs).allowed).toBe(true);
  });

  it('shortens the wait as the window runs out', () => {
    const limiter = createInMemoryRateLimiter(options);

    for (let attempt = 0; attempt <= options.limit; attempt += 1) {
      limiter.take('a', 0);
    }

    expect(limiter.take('a', 30_000).retryAfterSeconds).toBe(30);
  });
});
