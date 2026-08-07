/**
 * Rate limiting for the auth routes.
 *
 * The implementation here keeps counters in memory. That is enough for this
 * spike, but it is not enough for real traffic: every serverless instance holds
 * its own copy, so an attacker spread across instances gets a higher limit than
 * the number below suggests. Everything is behind the RateLimiter interface so
 * the in memory version can be replaced with a shared store (Postgres or a key
 * value service) without touching the routes.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  /** Seconds until the window resets. Zero when the request was allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Records one attempt for the key and says whether it may proceed. */
  take(key: string, now: number): RateLimitDecision;
}

export interface RateLimiterOptions {
  /** Attempts allowed inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, Window>();

  function forget(now: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) {
        windows.delete(key);
      }
    }
  }

  return {
    take(key, now) {
      forget(now);

      const current = windows.get(key);
      const window = current ?? { count: 0, resetAt: now + options.windowMs };

      window.count += 1;
      windows.set(key, window);

      const allowed = window.count <= options.limit;

      return {
        allowed,
        remaining: Math.max(0, options.limit - window.count),
        retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetAt - now) / 1000),
      };
    },
  };
}
