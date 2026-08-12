import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeAuthSkipReason, rawOwnerPool, testDatabase } from '../db/testing/database.js';
import { rateLimitKey, AUTH_ACCOUNT_LIMIT } from '../rate-limit.js';

import {
  CookieJar,
  GOOD_PASSWORD,
  harnessFor,
  registerFresh,
  signIn,
  uniqueAddress,
  uniqueEmail,
} from './testing/harness.js';

import type { Harness } from './testing/harness.js';
import type { TestDatabase } from '../db/testing/database.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * Signing in, staying signed in, and stopping being signed in.
 *
 * The cookie is the entire credential on every request after the first, so what
 * matters here is not that the happy path works but that everything around it
 * fails: a cookie that was edited, one that has expired, one belonging to a
 * session somebody has since closed.
 *
 * The database is shared with every other file in the run and is never emptied
 * here, so every person is minted fresh and every query is scoped to one of
 * them.
 */

const database = testDatabase();

describe.skipIf(!database)('sessions', () => {
  const testDb = database as TestDatabase;
  const hasAuthRole = Boolean(testDb.authUrl);
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

  describe.skipIf(!hasAuthRole)('signing in', () => {
    it('works with the right password', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'in');

      const { answer, jar } = await signIn(harness, person.email);

      expect(answer.status).toBe(200);
      expect((await harness.get('/account', { jar })).status).toBe(200);
    });

    it('issues a new session, and the previous one stops working', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'rotated');

      const first = await signIn(harness, person.email);
      const firstToken = first.jar.value('better-auth.session_token');

      // Signing out is what ends the first session. Signing in again elsewhere
      // does not, and should not: two devices are two sessions.
      await harness.post('/api/auth/sign-out', {}, { jar: first.jar });

      const second = await signIn(harness, person.email);

      expect(second.jar.value('better-auth.session_token')).not.toBe(firstToken);
      expect((await harness.get('/account', { jar: second.jar })).status).toBe(200);

      // The old cookie, put back by hand. The session behind it is gone.
      const stale = new CookieJar();

      stale.set('better-auth.session_token', firstToken as string);

      expect((await harness.get('/account', { jar: stale })).status).toBe(401);
    });

    it('answers a wrong password the same way as an address nobody uses', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'known');

      const wrongPassword = await signIn(harness, person.email, 'not-the-password-at-all');
      const unknownAddress = await signIn(
        harness,
        uniqueEmail('nobody'),
        'not-the-password-at-all',
      );

      // Same status, same code. Anything else turns the sign in form into a way
      // of asking which addresses have accounts here.
      expect(wrongPassword.answer.status).toBe(unknownAddress.answer.status);
      expect((wrongPassword.answer.body as { code?: string }).code).toBe(
        (unknownAddress.answer.body as { code?: string }).code,
      );
    });

    it('sets no session cookie when the password is wrong', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'nocookie');

      const failed = await signIn(harness, person.email, 'wrong-password-here');

      expect(failed.jar.names()).not.toContain('better-auth.session_token');
    });
  });

  describe.skipIf(!hasAuthRole)('a cookie that is not right', () => {
    it('is refused when there is none at all', async () => {
      const harness = harnessFor(testDb);

      await registerFresh(harness, 'anon');

      const answer = await harness.get<{ error?: { code: string } }>('/account', {
        jar: new CookieJar(),
      });

      expect(answer.status).toBe(401);
      expect(answer.body.error?.code).toBe('not_authenticated');
    });

    it('is refused when the session behind it has expired', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'expired');

      expect((await harness.get('/account', { jar: person.jar })).status).toBe(200);

      // Aged past its expiry rather than waited out. A month is a long test.
      // This person's sessions only: the table is shared with every other file.
      await owner.query(
        'update "session" set expires_at = now() - interval \'1 day\' where user_id = $1',
        [person.userId],
      );

      expect((await harness.get('/account', { jar: person.jar })).status).toBe(401);
    });

    it('is refused when somebody has edited it', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'tampered');
      const real = person.jar.value('better-auth.session_token') as string;

      // The cookie is `token.signature`. Changing the token half and leaving
      // the signature is exactly what somebody would try, and the signature is
      // what makes it pointless.
      const [token, signature] = real.split('.');
      const forged = new CookieJar();

      forged.set('better-auth.session_token', `${swapFirst(token as string)}.${signature ?? ''}`);

      expect((await harness.get('/account', { jar: forged })).status).toBe(401);
    });

    it('is refused when somebody has invented one', async () => {
      const harness = harnessFor(testDb);

      await registerFresh(harness, 'invented');

      const invented = new CookieJar();

      invented.set('better-auth.session_token', 'not-a-token.not-a-signature');

      expect((await harness.get('/account', { jar: invented })).status).toBe(401);
    });

    it('is refused for a session that has been deleted underneath it', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'deleted');

      await owner.query('delete from "session" where user_id = $1', [person.userId]);

      expect((await harness.get('/account', { jar: person.jar })).status).toBe(401);
    });
  });

  describe.skipIf(!hasAuthRole)('changing the password', () => {
    it('signs every other device out', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'changed');

      const phone = (await signIn(harness, person.email)).jar;
      const laptop = (await signIn(harness, person.email)).jar;

      expect((await harness.get('/account', { jar: phone })).status).toBe(200);

      const changed = await harness.post(
        '/api/auth/change-password',
        { currentPassword: GOOD_PASSWORD, newPassword: 'another-good-passphrase' },
        { jar: laptop },
      );

      expect(changed.status).toBe(200);

      // Changing a password is how somebody reacts to thinking their account
      // has been reached. A session opened with the old password surviving it
      // would mean the action did nothing about what they were worried about.
      expect((await harness.get('/account', { jar: phone })).status).toBe(401);
    });

    it('needs the current password', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'guessing');

      const refused = await harness.post(
        '/api/auth/change-password',
        { currentPassword: 'not-the-current-one', newPassword: 'another-good-passphrase' },
        { jar: person.jar },
      );

      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(harness, person.email)).answer.status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('the rate limiter', () => {
    /**
     * Guesses at one account until something says no.
     *
     * The per account limit is ten a minute, so this stops well short of thirty
     * whatever else is going on. Each attempt comes from its own address, so
     * what is being measured is the per account limit rather than the per
     * address one.
     */
    async function guessUntilBlocked(
      harness: Harness,
      email: string,
    ): Promise<{ attempt: number; retryAfter: string | null } | undefined> {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const answer = await harness.post(
          '/api/auth/sign-in/email',
          { email, password: `guess-number-${attempt}` },
          { jar: new CookieJar(), address: uniqueAddress() },
        );

        if (answer.status === 429) {
          return { attempt, retryAfter: answer.response.headers.get('retry-after') };
        }
      }

      return undefined;
    }

    it('stops a run of failed sign ins', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'guessed');

      const blocked = await guessUntilBlocked(harness, person.email);

      expect(blocked).toBeDefined();
      expect(blocked?.attempt).toBeLessThan(30);
    });

    it('says how long to wait', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'waiting');

      const blocked = await guessUntilBlocked(harness, person.email);

      // A refusal with no idea how long to wait is a refusal somebody retries
      // in a loop, which is the thing being prevented.
      expect(blocked?.retryAfter).not.toBeNull();
      expect(Number(blocked?.retryAfter)).toBeGreaterThan(0);
    });

    it('lets the right password through once the window has passed', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'recovered');

      await guessUntilBlocked(harness, person.email);

      // Aged out rather than waited out: the window is a minute and the penalty
      // doubles, so waiting for real would make this the slowest test here.
      // Only this account's bucket, because the table is shared.
      await owner.query(
        "update rate_limits set window_start = now() - interval '1 hour', " +
          "blocked_until = now() - interval '1 hour', count = 0, strikes = 0 where key = $1",
        [rateLimitKey(AUTH_ACCOUNT_LIMIT, person.email)],
      );

      const answer = await harness.post(
        '/api/auth/sign-in/email',
        { email: person.email, password: GOOD_PASSWORD },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(answer.status).toBe(200);
    });

    it('stops a run of attempts from one address, whoever they are aimed at', async () => {
      const harness = harnessFor(testDb);
      const address = uniqueAddress();

      // The second limit, and a different attack. The one above is per account
      // and catches a script working through passwords. This one is per
      // address and catches the same script spread across a list of addresses,
      // where no single account sees enough attempts to trip anything.
      let blocked: number | undefined;

      for (let attempt = 0; attempt < 40; attempt += 1) {
        const answer = await harness.post(
          '/api/auth/sign-in/email',
          { email: uniqueEmail('scattered'), password: 'guessing-at-everybody' },
          { jar: new CookieJar(), address },
        );

        if (answer.status === 429) {
          blocked = attempt;

          break;
        }
      }

      expect(blocked).toBeDefined();
      expect(blocked).toBeLessThan(40);
    });

    it('keeps no address and no email in the clear', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'hidden');

      await harness.post(
        '/api/auth/sign-in/email',
        { email: person.email, password: 'wrong-password-here' },
        { jar: new CookieJar(), address: person.address },
      );

      const rows = await owner.query<{ key: string }>('select key from rate_limits');

      expect(rows.rowCount).toBeGreaterThan(0);

      for (const row of rows.rows) {
        expect(row.key).not.toContain(person.email);
        expect(row.key).not.toContain(person.address);
      }
    });
  });

  describe.skipIf(!hasAuthRole)('signing out', () => {
    it('ends the session it was asked about and no other', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'out');

      const phone = (await signIn(harness, person.email)).jar;
      const laptop = (await signIn(harness, person.email)).jar;

      await harness.post('/api/auth/sign-out', {}, { jar: laptop });

      expect((await harness.get('/account', { jar: laptop })).status).toBe(401);
      expect((await harness.get('/account', { jar: phone })).status).toBe(200);
    });
  });
});

/**
 * Changes one character, so a token is wrong but still looks like one.
 *
 * @param value the token half of the cookie
 * @returns the same length, one character different
 */
function swapFirst(value: string): string {
  const first = value[0] === 'a' ? 'b' : 'a';

  return `${first}${value.slice(1)}`;
}
