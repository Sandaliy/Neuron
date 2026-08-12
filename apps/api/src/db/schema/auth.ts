import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { LOCALES, PLANS, THEMES } from '@neuron/shared';
import type { DeckSettings } from '@neuron/shared';

import { literalList } from './columns.js';

/**
 * The four tables Better Auth needs, plus the settings that hang off a user.
 *
 * The property names on the left have to match the field names Better Auth
 * uses, because its Drizzle adapter looks tables up by them. The column names
 * on the right are ours, so they follow the snake_case convention of the rest
 * of the database.
 *
 * Everything Neuron adds to `user` carries a database default. Better Auth
 * writes only the fields it knows about when someone signs up, so a column
 * without one would make registration fail.
 */

/** Written into a fresh row before the user has said where they live. */
const FALLBACK_TIME_ZONE = 'UTC';

/**
 * A study day starts at four in the morning, not at midnight.
 *
 * Someone answering cards at one in the morning is finishing the previous day,
 * and a counter that disagrees is a counter they stop believing.
 */
const DEFAULT_DAY_CUTOFF_HOUR = 4;

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // Everything below this line is Neuron's, not Better Auth's.

    /** An IANA name. Decides when one study day ends and the next begins. */
    timezone: text('timezone').notNull().default(FALLBACK_TIME_ZONE),
    dayCutoffHour: smallint('day_cutoff_hour').notNull().default(DEFAULT_DAY_CUTOFF_HOUR),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').notNull().default('system'),
    /** Space held for tiers that do not exist yet. Everyone is on `free`. */
    plan: text('plan').notNull().default('free'),
    /**
     * The root of the settings chain: budget, ladder, retention target.
     *
     * A deck inherits from its parent, and the outermost parent is the user, so
     * this holds the same shape a deck does and is validated with the same
     * schema.
     */
    settings: jsonb('settings').$type<DeckSettings>().notNull().default({}),
    /**
     * The user's version counter.
     *
     * Every write bumps it and stamps the row it wrote, so a client that
     * remembers the last number it saw can ask for exactly what it missed.
     */
    currentRev: bigint('current_rev', { mode: 'number' }).notNull().default(0),
    /**
     * Whether this account has a second factor turned on.
     *
     * Better Auth's two factor plugin owns this column and will not create a
     * user without it. False for everybody until they choose otherwise: the
     * second factor is optional and nothing in the app may require it.
     */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /**
     * When the person asked for their account to be erased.
     *
     * Deleting an account does not remove the row. It anonymises the personal
     * data, drops the credentials and the sessions, and sets this. The row goes
     * away thirty days later, in a cleanup run as the database owner, which is
     * the only connection allowed to remove a review. The delay is what makes
     * the action recoverable by hand for someone who regrets it.
     */
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('user_email_key').on(table.email),
    /** The cleanup task's query: who has been waiting out their thirty days. */
    index('user_deletion_requested_idx').on(table.deletionRequestedAt),
    check('user_day_cutoff_hour_range', sql`${table.dayCutoffHour} between 0 and 23`),
    check('user_locale_known', sql`${table.locale} in (${literalList(LOCALES)})`),
    check('user_theme_known', sql`${table.theme} in (${literalList(THEMES)})`),
    check('user_plan_known', sql`${table.plan} in (${literalList(PLANS)})`),
    check('user_current_rev_not_negative', sql`${table.currentRev} >= 0`),
  ],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * True for a session opened with a recovery code, until it sets a password.
     *
     * A recovery code is the whole credential, so the session it opens is not a
     * normal one. It may do exactly one thing, and every other route refuses
     * it. The flag lives on the session row rather than in a second table
     * because Better Auth already reads this row on every request, so checking
     * it costs nothing; a separate table would add a query to the hot path in
     * order to answer a question about a state almost nobody is ever in.
     */
    passwordChangeRequired: boolean('password_change_required').notNull().default(false),
  },
  (table) => [
    uniqueIndex('session_token_key').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    // The argon2id hash of the password. Never the password itself.
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

/**
 * The account recovery codes.
 *
 * Ten of them, issued when somebody registers, each good once. Until there is a
 * mail sender there is no other way back into an account, so these are not a
 * step towards recovery: they are the credential. That is why they live here,
 * next to the password hashes, reachable only by the authentication role.
 *
 * One row per code rather than an array on the user, because spending a code
 * then has to touch exactly one row and can be made conditional on that row
 * still being unspent. An array would mean read, modify, write, which two
 * requests arriving together can both do.
 */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * The argon2id hash of the code, with the same parameters as a password.
     *
     * Hashed rather than encrypted, because nothing ever needs to read a code
     * back. A code is only ever compared against one somebody typed, and a
     * scheme that can produce the original is a scheme where a copy of this
     * table plus the key is a set of working credentials.
     */
    codeHash: text('code_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When it was spent. A code is used once and is then only a record. */
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    index('recovery_codes_user_id_idx').on(table.userId),
    /** The query that counts what is left, and the one that spends a code. */
    index('recovery_codes_unused_idx').on(table.userId, table.usedAt),
  ],
);

/**
 * The second factor, when somebody has chosen to have one.
 *
 * Better Auth's two factor plugin owns the first five columns and looks the
 * table up by the property name `twoFactor`, so that name is fixed. The secret
 * and the backup codes arrive already encrypted with the server secret; this
 * table never sees either in the clear.
 */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The TOTP shared secret, encrypted with BETTER_AUTH_SECRET. */
    secret: text('secret').notNull(),
    /** The codes for a lost phone, encrypted the same way. */
    backupCodes: text('backup_codes').notNull(),
    /**
     * False between scanning the QR code and typing the first code it shows.
     *
     * Enrollment is not active until that happens, so a QR code read wrong, or
     * read into an app that is then deleted, locks nobody out.
     */
    verified: boolean('verified').notNull().default(false),
    failedVerificationCount: smallint('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /**
     * The last thirty second step this account has already spent.
     *
     * Neuron's, not Better Auth's. The plugin accepts any code inside the skew
     * window, which means a code read over somebody's shoulder works for as
     * long as that window lasts. Refusing anything at or below the last
     * accepted step makes a code good exactly once.
     *
     * A default is required: Better Auth writes this row without naming the
     * column, so a column it has to supply would make enrollment fail.
     */
    lastTotpStep: bigint('last_totp_step', { mode: 'number' }).notNull().default(0),
  },
  (table) => [uniqueIndex('two_factor_user_id_key').on(table.userId)],
);

/**
 * How many accounts one address has successfully created today.
 *
 * Separate from `rate_limits`, which counts attempts. An attempt limit stops a
 * script guessing passwords; it does nothing about somebody registering three
 * hundred accounts patiently, one every ten seconds, each attempt succeeding.
 * Both exist only until email verification is switched on.
 *
 * The address is hashed, so this table says how many accounts came from
 * somewhere and nothing about where.
 */
export const registrationCounts = pgTable(
  'registration_counts',
  {
    addressHash: text('address_hash').notNull(),
    /** The UTC day. The cap is per day and the day does not need a timezone. */
    day: text('day').notNull(),
    count: smallint('count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('registration_counts_key').on(table.addressHash, table.day)],
);
