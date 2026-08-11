import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { instant } from './columns.js';

/**
 * Where the rate limiter counts.
 *
 * The counters used to live in memory, which works on one long lived process
 * and does not work here. Every serverless invocation may be a fresh instance,
 * so an attacker spread across instances gets as many attempts as there happen
 * to be instances. The counters have to be somewhere both invocations can see,
 * and the database is already there. Redis would be a second service to run,
 * pay for and monitor for traffic that is three people.
 *
 * The row holds no user data. The key is a hash, never an email or an address
 * in the clear, so a copy of this table says how often something was tried and
 * nothing about who tried it.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** `bucket:sha256(identifier)`. Never the identifier itself. */
    key: text('key').primaryKey(),
    /** When the current window opened. */
    windowStart: instant('window_start').notNull().defaultNow(),
    /** Attempts made inside the current window. */
    count: integer('count').notNull().default(0),
    /**
     * How many windows in a row have gone over the limit.
     *
     * What makes the wait grow. One bad window is a typo, six in a row is
     * someone working through a list, and the wait should tell them apart.
     */
    strikes: integer('strikes').notNull().default(0),
    /** Set while the key is shut out. Null when it is not. */
    blockedUntil: instant('blocked_until'),
    /** When this row stops meaning anything and may be swept away. */
    expiresAt: instant('expires_at').notNull(),
  },
  (table) => [
    index('rate_limits_expires_idx').on(table.expiresAt),
    check('rate_limits_count_not_negative', sql`${table.count} >= 0`),
    check('rate_limits_strikes_not_negative', sql`${table.strikes} >= 0`),
  ],
);
