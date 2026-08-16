import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { deleteAccountSchema, updatePreferencesSchema } from '@neuron/shared';
import type { DeckSettings, Locale, Theme } from '@neuron/shared';

import { repositoriesOf, signedIn } from '../context.js';
import { account, session, user } from '../db/schema/index.js';
import { readBody } from '../validation.js';

import type { RequestBindings, ServerParts } from '../context.js';
import type { AuthDatabase } from '../db/client.js';

/**
 * The account: who is signed in, what they have chosen, and how to leave.
 */

/** How long a deleted account stays recoverable by hand. */
const GRACE_DAYS = 30;

/**
 * Removes the personal data and marks the row.
 *
 * On the authentication connection, because the application role cannot read
 * or write the name, the email or anything in `account`. That is the same
 * separation that stops a route handler from reading somebody's email address,
 * working here as intended rather than getting in the way.
 *
 * Three things happen. The name and the address are replaced, so nothing
 * identifying is left on the row. Every credential goes: the password hash and
 * any OAuth tokens, so the account cannot be signed into again. Every session
 * goes, so the devices already holding one are signed out.
 *
 * The row itself stays, marked, and is removed thirty days later by a cleanup
 * that runs as the database owner. That delay is the only reason a person who
 * changes their mind can be brought back, and the owner connection is the only
 * one allowed to remove a review.
 *
 * @param db the authentication connection
 * @param userId who is leaving
 * @param now the moment they asked
 */
async function anonymise(db: AuthDatabase, userId: string, now: Date): Promise<void> {
  await db
    .update(user)
    .set({
      name: 'Deleted account',
      // A domain reserved by the standards body for exactly this: it can never
      // be registered, so the address cannot reach anybody and cannot collide
      // with a real one if the person signs up again.
      email: `deleted-${userId}@deleted.invalid`,
      emailVerified: false,
      image: null,
      deletionRequestedAt: now,
      updatedAt: now,
    })
    .where(eq(user.id, userId));

  await db.delete(account).where(eq(account.userId, userId));
  await db.delete(session).where(eq(session.userId, userId));
}

export function accountRoutes(parts: ServerParts): Hono<RequestBindings> {
  const routes = new Hono<RequestBindings>();

  routes.get('/', async (context) => {
    const person = signedIn(context);
    const row = await repositoriesOf(context).account.read();

    return context.json({
      id: person.id,
      name: person.name,
      email: person.email,
      image: person.image,
      locale: row.locale,
      theme: row.theme,
      timezone: row.timezone,
      dayCutoffHour: row.dayCutoffHour,
      plan: row.plan,
      settings: row.settings,
      twoFactorEnabled: person.twoFactorEnabled,
      revision: row.currentRev,
    });
  });

  routes.patch('/', async (context) => {
    const body = await readBody(context, updatePreferencesSchema);
    const row = await repositoriesOf(context).account.updatePreferences({
      ...(body.locale === undefined ? {} : { locale: body.locale as Locale }),
      ...(body.theme === undefined ? {} : { theme: body.theme as Theme }),
      ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
      ...(body.dayCutoffHour === undefined ? {} : { dayCutoffHour: body.dayCutoffHour }),
      ...(body.settings === undefined ? {} : { settings: body.settings as DeckSettings }),
    });

    return context.json({
      locale: row.locale,
      theme: row.theme,
      timezone: row.timezone,
      dayCutoffHour: row.dayCutoffHour,
      settings: row.settings,
      revision: row.currentRev,
    });
  });

  routes.delete('/', async (context) => {
    await readBody(context, deleteAccountSchema);

    const person = signedIn(context);
    const now = new Date();

    // The collection first, over the application connection, then the person,
    // over the authentication one. In that order, because the second one takes
    // away the session this request is using.
    await repositoriesOf(context).account.softDeleteCollection();
    await anonymise(parts.authDb, person.id, now);

    const erasesAt = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

    return context.json({ erasesAt: erasesAt.toISOString() });
  });

  return routes;
}
