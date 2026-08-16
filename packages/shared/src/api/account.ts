import { z } from 'zod';

import { deckSettingsSchema } from '../deck-settings.js';
import { dayCutoffHourSchema, localeSchema, themeSchema, timeZoneSchema } from '../preferences.js';

/**
 * The account: who is signed in, what they have chosen, and how to leave.
 */

export const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  locale: localeSchema,
  theme: themeSchema,
  timezone: z.string(),
  dayCutoffHour: z.number().int(),
  plan: z.string(),
  settings: deckSettingsSchema,
  /**
   * Whether the second factor is on.
   *
   * Here rather than asked for separately, because every screen that offers to
   * turn it on or off has to know first. Settings offered both at once, so an
   * account with no second factor still had a control for turning one off.
   */
  twoFactorEnabled: z.boolean(),
  /** The sync cursor as it stands right now. */
  revision: z.number().int(),
});

export const updatePreferencesSchema = z
  .strictObject({
    locale: localeSchema.optional(),
    theme: themeSchema.optional(),
    timezone: timeZoneSchema.optional(),
    dayCutoffHour: dayCutoffHourSchema.optional(),
    /** The root of the settings chain every deck inherits from. */
    settings: deckSettingsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'needs something to change');

/**
 * Leaving.
 *
 * The password, and a code from the authenticator app when the account has one.
 * It was a phrase typed into a box, which proves only that somebody can read
 * and copy. This is the one action here that cannot be undone from inside the
 * app, and the session it is reached from is exactly what a borrowed unlocked
 * laptop hands to somebody else.
 */
export const deleteAccountSchema = z.strictObject({
  password: z.string().min(1).max(200),
  /** Required when the second factor is on, refused when it is not. */
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const deleteAccountResultSchema = z.object({
  /** When the rows actually go. Until then a person can be restored by hand. */
  erasesAt: z.string(),
});

export type Me = z.infer<typeof meSchema>;
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesSchema>;
export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;
