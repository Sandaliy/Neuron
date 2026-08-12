import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issueReset } from '../db/admin/reset-password.js';
import { describeAuthSkipReason, rawOwnerPool, testDatabase } from '../db/testing/database.js';

import {
  CookieJar,
  GOOD_PASSWORD,
  harnessFor,
  registerFresh,
  signIn,
  uniqueAddress,
  uniqueEmail,
} from './testing/harness.js';

import type { TestDatabase } from '../db/testing/database.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * The last way back in, for somebody who has lost the password and every code.
 *
 * There is no route for this and there should not be: a route that takes no
 * password and proves nothing about who is asking is a route for anybody. What
 * exists instead is a script run by a person holding the database owner's
 * connection string, which the deployed server never receives.
 *
 * Tested through the same reset endpoint a person would use, so what is covered
 * is the whole path rather than the one statement the script writes.
 *
 * The database is shared with every other file in the run and is never emptied
 * here, so every person is minted fresh and every query is scoped to one of
 * them.
 */

const database = testDatabase();

describe.skipIf(!database)('the admin password reset', () => {
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

  describe.skipIf(!hasAuthRole)('issuing one', () => {
    it('produces a token the ordinary reset endpoint accepts', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'stuck');

      const { token } = await issueReset(owner, person.email);

      const reset = await harness.post(
        '/api/auth/reset-password',
        { token, newPassword: 'rescued-by-the-admin' },
        { jar: new CookieJar() },
      );

      expect(reset.status).toBeLessThan(400);
      expect((await signIn(harness, person.email, 'rescued-by-the-admin')).answer.status).toBe(200);
    });

    it('leaves the old password not working', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'replaced');

      const { token } = await issueReset(owner, person.email);

      await harness.post(
        '/api/auth/reset-password',
        { token, newPassword: 'the-replacement-passphrase' },
        { jar: new CookieJar() },
      );

      expect(
        (await signIn(harness, person.email, GOOD_PASSWORD)).answer.status,
      ).toBeGreaterThanOrEqual(400);
    });

    it('closes every session the account had', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'kicked');

      const phone = (await signIn(harness, person.email)).jar;

      expect((await harness.get('/account', { jar: phone })).status).toBe(200);

      await issueReset(owner, person.email);

      // Somebody who needs this has lost control of their credentials, so a
      // session opened before now may not be theirs.
      expect((await harness.get('/account', { jar: phone })).status).toBe(401);
    });

    it('stores the token as a digest, not as itself', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'digest');

      const { token } = await issueReset(owner, person.email);
      const rows = await owner.query<{ identifier: string; value: string }>(
        'select identifier, value from verification',
      );

      expect(rows.rowCount).toBeGreaterThan(0);

      for (const row of rows.rows) {
        expect(row.identifier).not.toContain(token);
      }
    });

    it('works once', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'onlyonce');

      const { token } = await issueReset(owner, person.email);

      await harness.post(
        '/api/auth/reset-password',
        { token, newPassword: 'the-first-replacement' },
        { jar: new CookieJar() },
      );

      const again = await harness.post(
        '/api/auth/reset-password',
        { token, newPassword: 'a-second-replacement' },
        { jar: new CookieJar() },
      );

      expect(again.status).toBeGreaterThanOrEqual(400);
    });

    it('still applies the password policy', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'stillweak');

      const { token } = await issueReset(owner, person.email);
      const refused = await harness.post<{ code?: string }>(
        '/api/auth/reset-password',
        { token, newPassword: 'password123' },
        { jar: new CookieJar() },
      );

      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('weak_password');
    });

    it('leaves the recovery codes alone, because they are a separate credential', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'codesstay');

      const { token } = await issueReset(owner, person.email);

      await harness.post(
        '/api/auth/reset-password',
        { token, newPassword: 'a-new-passphrase-here' },
        { jar: new CookieJar() },
      );

      const used = await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(used.status).toBe(200);
    });

    it('refuses an address nobody uses', async () => {
      await expect(issueReset(owner, uniqueEmail('nobody'))).rejects.toThrow(/No account uses/);
    });

    it('refuses an account that has asked to be erased', async () => {
      const harness = harnessFor(testDb);

      const person = await registerFresh(harness, 'leaving');

      // This person's row only. The table is shared with every other file.
      await owner.query('update "user" set deletion_requested_at = now() where id = $1', [
        person.userId,
      ]);

      // Bringing somebody back from a deletion they asked for is a decision,
      // not a side effect of resetting a password.
      await expect(issueReset(owner, person.email)).rejects.toThrow(/erased/);
    });
  });
});
