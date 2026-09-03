import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeAuthSkipReason, rawOwnerPool, testDatabase } from '../db/testing/database.js';

import {
  CookieJar,
  GOOD_PASSWORD,
  harnessFor,
  register,
  signIn,
  uniqueAddress,
  uniqueEmail,
} from './testing/harness.js';

import type { Harness } from './testing/harness.js';
import type { TestDatabase } from '../db/testing/database.js';
import type { MailMessage } from '../mailer.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * The email path, driven with the flag on.
 *
 * Nothing is delivered anywhere. `MAILER` names the log mailer, which keeps
 * what it was asked to send, and these tests read the token straight out of it.
 * That is the whole reason the seam was built now rather than on the day a
 * domain appears: the code being switched on then has already been run through,
 * end to end, hundreds of times.
 *
 * Both settings are covered, because both are real. Off is what ships today.
 *
 * The database is shared with every other file in the run and is never emptied
 * here, so every person is minted fresh and every query is scoped to one of
 * them.
 */

const database = testDatabase();

describe.skipIf(!database)('email verification', () => {
  const testDb = database as TestDatabase;
  const hasAuthRole = Boolean(database?.authUrl);
  let owner: Pool;

  beforeAll(() => {
    if (!hasAuthRole) {
      console.warn(describeAuthSkipReason());
    }

    owner = rawOwnerPool(testDb);
  });

  afterAll(async () => {
    await owner.end();
  });

  /**
   * Registers somebody against a server with the flag set as the test wants.
   *
   * Not `registerFresh`, because with verification on there is no session to
   * come back and the helper's expectations are about the ordinary case.
   */
  async function signUp(
    harness: Harness,
    label: string,
  ): Promise<{ email: string; userId: string; jar: CookieJar }> {
    const email = uniqueEmail(label);
    const { answer, jar } = await register(harness, email, { address: uniqueAddress() });

    if (answer.status !== 200) {
      throw new Error(
        `registering ${label} failed: ${answer.status} ${JSON.stringify(answer.body)}`,
      );
    }

    return { email, userId: answer.body.user.id, jar };
  }

  describe.skipIf(!hasAuthRole)('with the flag off, which is what ships', () => {
    it('lets a new account straight in', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: false });
      const person = await signUp(harness, 'immediate');

      expect((await harness.get('/api/account', { jar: person.jar })).status).toBe(200);
      expect((await harness.get('/api/decks', { jar: person.jar })).status).toBe(200);
    });

    it('sends nothing at all', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: false });

      await signUp(harness, 'quiet');

      // Not "sends and drops": nothing is composed. Somebody watching the log
      // sees no message about a link that is not coming.
      expect(harness.mailer.sent).toHaveLength(0);
    });

    it('lets somebody sign back in without confirming anything', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: false });
      const person = await signUp(harness, 'returning');

      const { answer, jar } = await signIn(harness, person.email);

      expect(answer.status).toBe(200);
      expect((await harness.get('/api/account', { jar })).status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('with the flag on', () => {
    it('writes a message with a link in it', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'link');

      const message = harness.mailer.lastTo(person.email);

      expect(message).toBeDefined();
      expect(message?.subject).toMatch(/confirm/i);
      expect(tokenFrom(message)).toBeTruthy();
    });

    it('refuses the whole collection until the address is confirmed', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'blocked');

      const { jar } = await signIn(harness, person.email);

      // Signing in does not even produce a session while the address is
      // unconfirmed, so every route is closed rather than a chosen few.
      for (const path of ['/api/account', '/api/decks', '/api/cards', '/api/sync']) {
        expect((await harness.get(path, { jar })).status).toBeGreaterThanOrEqual(400);
      }
    });

    it('opens up once the link has been followed', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'confirming');

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const verified = await harness.get(`/api/auth/verify-email?token=${token}`, {
        jar: new CookieJar(),
      });

      expect(verified.status).toBeLessThan(400);

      const row = await owner.query<{ email_verified: boolean }>(
        'select email_verified from "user" where id = $1',
        [person.userId],
      );

      expect(row.rows[0]?.email_verified).toBe(true);

      const { answer, jar } = await signIn(harness, person.email);

      expect(answer.status).toBe(200);
      expect((await harness.get('/api/account', { jar })).status).toBe(200);
    });

    it('gives a second use of the same link nothing', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'once');

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const first = new CookieJar();

      await harness.get(`/api/auth/verify-email?token=${token}`, { jar: first });

      // Worth being exact about what this covers, because it is not what the
      // phase asked for. Better Auth's verification token is a signed, expiring
      // JWT rather than a row, so there is nothing to consume and a second use
      // is not refused. What matters is that a second use gains nothing: the
      // address is already confirmed, so the handler returns before it would
      // have created a session, and no cookie comes back. A link read out of
      // somebody's inbox is not a way into their account.
      const again = new CookieJar();
      const answer = await harness.get(`/api/auth/verify-email?token=${token}`, { jar: again });

      expect(answer.status).toBeLessThan(400);
      expect(again.names()).not.toContain('better-auth.session_token');
      expect(first.names()).toContain('better-auth.session_token');
    });

    it('will not take a link whose signature does not check out', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'stale');

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const forged = token.replace(/\.[^.]*$/, '.not-the-right-signature');

      const answer = await harness.get(`/api/auth/verify-email?token=${forged}`, {
        jar: new CookieJar(),
      });

      expect(answer.status).toBeGreaterThanOrEqual(400);
    });

    it('will not take a link somebody made up', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });

      await signUp(harness, 'forged');

      const answer = await harness.get('/api/auth/verify-email?token=not-a-real-token', {
        jar: new CookieJar(),
      });

      expect(answer.status).toBeGreaterThanOrEqual(400);
    });

    it('keeps no token in the clear', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'hashedtoken');

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const rows = await owner.query<{ identifier: string; value: string }>(
        'select identifier, value from verification',
      );

      // Every row, not only this person's: the claim is that this token is
      // nowhere, which is stronger and just as cheap to check.
      for (const row of rows.rows) {
        expect(row.identifier).not.toContain(token);
        expect(row.value).not.toContain(token);
      }
    });

    it('sends another one when asked', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'resend');

      harness.mailer.clear();

      const asked = await harness.post(
        '/api/auth/send-verification-email',
        { email: person.email },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(asked.status).toBeLessThan(400);

      // A second message, carrying a link that works. Not a second distinct
      // token: the token is a JWT over the address and an expiry counted in
      // whole seconds, so two asked for inside the same second are byte for
      // byte the same string. That is the design working, not a collision.
      const message = harness.mailer.lastTo(person.email);

      expect(message).toBeDefined();

      const verified = await harness.get(`/api/auth/verify-email?token=${tokenFrom(message)}`, {
        jar: new CookieJar(),
      });

      expect(verified.status).toBeLessThan(400);
      expect((await signIn(harness, person.email)).answer.status).toBe(200);
    });

    it('says the same thing when asked about an address nobody uses', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const nobody = uniqueEmail('nobody');

      await signUp(harness, 'existing');
      harness.mailer.clear();

      const asked = await harness.post(
        '/api/auth/send-verification-email',
        { email: nobody },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(asked.status).toBeLessThan(400);
      expect(harness.mailer.lastTo(nobody)).toBeUndefined();
    });
  });

  describe.skipIf(!hasAuthRole)('resetting a password by email', () => {
    it('writes a message with a link in it', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'forgot');

      harness.mailer.clear();

      const asked = await harness.post(
        '/api/auth/request-password-reset',
        { email: person.email, redirectTo: '/reset-password' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(asked.status).toBeLessThan(400);

      const message = harness.mailer.lastTo(person.email);

      expect(message?.subject).toMatch(/reset/i);
      expect(tokenFrom(message)).toBeTruthy();
    });

    it('changes the password and closes every session', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'resetting');

      // Confirm the address first, so signing in is possible at all.
      const confirmation = tokenFrom(harness.mailer.lastTo(person.email));

      await harness.get(`/api/auth/verify-email?token=${confirmation}`, { jar: new CookieJar() });

      const phone = (await signIn(harness, person.email)).jar;

      expect((await harness.get('/api/account', { jar: phone })).status).toBe(200);

      harness.mailer.clear();

      await harness.post(
        '/api/auth/request-password-reset',
        { email: person.email, redirectTo: '/reset-password' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const reset = await harness.post(
        '/api/auth/reset-password',
        { token, newPassword: 'a-completely-new-passphrase' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(reset.status).toBeLessThan(400);

      // The new password works, the old one does not, and the device that was
      // signed in before is not any more.
      expect(
        (await signIn(harness, person.email, 'a-completely-new-passphrase')).answer.status,
      ).toBe(200);
      expect(
        (await signIn(harness, person.email, GOOD_PASSWORD)).answer.status,
      ).toBeGreaterThanOrEqual(400);
      expect((await harness.get('/api/account', { jar: phone })).status).toBe(401);
    });

    it('applies the password policy to the new password', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'weakreset');

      harness.mailer.clear();

      await harness.post(
        '/api/auth/request-password-reset',
        { email: person.email, redirectTo: '/reset-password' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const refused = await harness.post<{ code?: string }>(
        '/api/auth/reset-password',
        { token, newPassword: 'password123' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('weak_password');
    });

    it('keeps the token out of the database in readable form', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const person = await signUp(harness, 'hashedreset');

      harness.mailer.clear();

      await harness.post(
        '/api/auth/request-password-reset',
        { email: person.email, redirectTo: '/reset-password' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      const token = tokenFrom(harness.mailer.lastTo(person.email));
      const rows = await owner.query<{ identifier: string; value: string }>(
        'select identifier, value from verification',
      );

      // Better Auth stores this token as the row's identifier, in the clear.
      // Anybody who could read that table could reset any password in it, so
      // the row is rewritten with a digest before the token leaves the server.
      for (const row of rows.rows) {
        expect(row.identifier).not.toContain(token);
        expect(row.value).not.toContain(token);
      }
    });

    it('says the same thing for an address nobody uses', async () => {
      const harness = harnessFor(testDb, { requireEmailVerification: true });
      const nobody = uniqueEmail('nobody');

      await signUp(harness, 'real');
      harness.mailer.clear();

      const unknown = await harness.post(
        '/api/auth/request-password-reset',
        { email: nobody, redirectTo: '/reset-password' },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(unknown.status).toBeLessThan(400);

      // Nothing was composed, because there is nobody to compose it for, and
      // the answer is the same either way. A different answer would turn this
      // into a way of asking which addresses have accounts.
      expect(harness.mailer.lastTo(nobody)).toBeUndefined();
    });
  });
});

/**
 * Pulls the token out of a message the log mailer kept.
 *
 * @param message what was sent, if anything was
 * @returns the token from the link
 */
function tokenFrom(message: MailMessage | undefined): string {
  if (!message) {
    throw new Error('no message was sent');
  }

  const found = /[?&]token=([^\s&]+)/.exec(message.body);

  if (!found?.[1]) {
    throw new Error(`no token in the message body:\n${message.body}`);
  }

  return found[1];
}
