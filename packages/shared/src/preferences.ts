import { z } from 'zod';

import { isSupportedTimeZone } from '@neuron/core';

/**
 * The choices a person makes once and rarely revisits.
 *
 * These sit as columns on the user row rather than inside its settings blob,
 * because every one of them is read on every request: the interface needs the
 * language and the theme before it can draw anything, and the scheduler needs
 * the timezone before it can say what "today" means.
 */

/** The two languages the interface exists in. */
export const LOCALES = ['en', 'ru'] as const;

export const localeSchema = z.enum(LOCALES);

export type Locale = z.infer<typeof localeSchema>;

/** Dark by default, with the option of following the operating system. */
export const THEMES = ['system', 'light', 'dark'] as const;

export const themeSchema = z.enum(THEMES);

export type Theme = z.infer<typeof themeSchema>;

/** Placeholder for tiers that do not exist yet. Everyone is on `free`. */
export const PLANS = ['free'] as const;

export const planSchema = z.enum(PLANS);

export type Plan = z.infer<typeof planSchema>;

/**
 * A timezone the platform can actually do arithmetic in.
 *
 * Checked against Intl rather than against a list, because a list would be out
 * of date the next time a country moves its clocks.
 */
export const timeZoneSchema = z
  .string()
  .min(1)
  .refine(isSupportedTimeZone, 'must be a timezone name such as Europe/Moscow');

/**
 * The hour a study day starts, in the user's own timezone.
 *
 * Four in the morning, not midnight: someone answering cards at one in the
 * morning is finishing the previous day, and a streak counter that disagrees
 * with them is a streak counter nobody trusts.
 */
export const dayCutoffHourSchema = z.number().int().min(0).max(23);
