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
