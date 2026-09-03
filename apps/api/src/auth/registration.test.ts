import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RECOVERY_CODE_COUNT, normaliseRecoveryCode } from '@neuron/shared';

import { describeAuthSkipReason, rawOwnerPool, testDatabase } from '../db/testing/database.js';

import { addressKey } from './registration.js';
import {
  CookieJar,
  GOOD_PASSWORD,
  harnessFor,
  register,
  registerFresh,
  signIn,
  uniqueAddress,
  uniqueEmail,
} from './testing/harness.js';

import type { TestDatabase } from '../db/testing/database.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * Registering, the two guards on it, and the recovery codes it hands out.
 *
 * The real Better Auth, the real argon2, the real database, and a cookie jar
 * that behaves like a browser. Nothing here is stubbed, because everything here
 * is about the part of the system a stub would replace.
 *
 * Nothing here empties the database either. The whole run shares one, emptied
 * once in the global setup, so a file that truncated between its own tests
 * would be pulling rows out from under the file running beside it. Every
 * address and every caller address is minted unique instead, and every query
 * against the shared tables is scoped to the person the test is about.
 */

const database = testDatabase();

describe.skipIf(!database)('registration', () => {
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

  describe.skipIf(!hasAuthRole)('creating an account', () => {
    it('succeeds and hands back exactly ten recovery codes', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'first');

      expect(person.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(new Set(person.recoveryCodes).size).toBe(RECOVERY_CODE_COUNT);
    });

    it('says next to them that they are the whole credential', async () => {
      const harness = harnessFor(testDb);
      const { answer } = await register(harness, uniqueEmail('warned'), {
        address: uniqueAddress(),
      });

      // A key rather than a sentence: the server does not choose between
      // English and Russian, and this particular sentence is the one thing
      // between somebody and giving their account away.
      expect(answer.body.warningKey).toBe('auth.recoveryCodes.warning');
    });

    it('shows each code in groups, so it can be read off a screen', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'grouped');

      for (const code of person.recoveryCodes) {
        expect(code).toMatch(/^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
      }
    });

    it('stores no code in a form anybody can read', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'hashed');

      // Every column of every table, as text. A test that only looked in
      // recovery_codes would prove the codes are not in the column somebody
      // remembered to check. This proves they are not anywhere.
      const dump = await dumpDatabase(owner);

      for (const code of person.recoveryCodes) {
        expect(dump).not.toContain(code);
        expect(dump).not.toContain(normaliseRecoveryCode(code));
      }
    });

    it('stores the password nowhere in plain text either', async () => {
      const harness = harnessFor(testDb);

      await registerFresh(harness, 'secret');

      expect(await dumpDatabase(owner)).not.toContain(GOOD_PASSWORD);
    });

    it('signs the person in, so the codes screen is the only thing in the way', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'signedin');

      expect((await harness.get('/api/account', { jar: person.jar })).status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('the switch that closes registration', () => {
    it('refuses everybody new when it is off', async () => {
      const harness = harnessFor(testDb, { registrationOpen: false });
      const { answer } = await register(harness, uniqueEmail('late'), {
        address: uniqueAddress(),
      });

      expect(answer.status).toBe(403);
      expect((answer.body as { code?: string }).code).toBe('registration_closed');
    });

    it('leaves everybody who already has an account alone', async () => {
      const open = harnessFor(testDb);
      const person = await registerFresh(open, 'early');

      // Same database, a server with the switch off. The account made a moment
      // ago has to keep working exactly as it did.
      const closed = harnessFor(testDb, { registrationOpen: false });
      const { answer, jar } = await signIn(closed, person.email);

      expect(answer.status).toBe(200);
      expect((await closed.get('/api/account', { jar })).status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('the daily cap per address', () => {
    it('allows the allowance and then refuses', async () => {
      const harness = harnessFor(testDb, { maxRegistrationsPerDay: 2 });
      const address = uniqueAddress();

      const first = await register(harness, uniqueEmail('cap'), { address });
      const second = await register(harness, uniqueEmail('cap'), { address });
      const third = await register(harness, uniqueEmail('cap'), { address });

      expect(first.answer.status).toBe(200);
      expect(second.answer.status).toBe(200);
      expect(third.answer.status).toBe(429);
    });

    it('counts successes, not attempts', async () => {
      const harness = harnessFor(testDb, { maxRegistrationsPerDay: 2 });
      const address = uniqueAddress();

      // Two attempts that fail on the password policy. If the cap counted
      // attempts, these would use the whole allowance up and the person who
      // finally chose an acceptable password would be turned away.
      await register(harness, uniqueEmail('weak'), { password: 'short', address });
      await register(harness, uniqueEmail('weak'), { password: 'short', address });

      const real = await register(harness, uniqueEmail('real'), { address });

      expect(real.answer.status).toBe(200);
    });

    it('counts one address at a time', async () => {
      const harness = harnessFor(testDb, { maxRegistrationsPerDay: 1 });

      await register(harness, uniqueEmail('here'), { address: uniqueAddress() });

      const elsewhere = await register(harness, uniqueEmail('there'), {
        address: uniqueAddress(),
      });

      expect(elsewhere.answer.status).toBe(200);
    });

    it('starts again the next day', async () => {
      const harness = harnessFor(testDb, { maxRegistrationsPerDay: 1 });
      const address = uniqueAddress();

      await register(harness, uniqueEmail('today'), { address });

      const blocked = await register(harness, uniqueEmail('alsotoday'), { address });

      expect(blocked.answer.status).toBe(429);

      // The row is keyed on the day, so yesterday's row is not tomorrow's. Aged
      // by hand rather than by waiting, and only this address's row, because
      // the table is shared with every other test running right now.
      await owner.query(
        'update registration_counts set day = (current_date - 1)::text where address_hash = $1',
        [addressKey(address)],
      );

      const tomorrow = await register(harness, uniqueEmail('tomorrow'), { address });

      expect(tomorrow.answer.status).toBe(200);
    });

    it('stores no address, only a hash of one', async () => {
      const harness = harnessFor(testDb);
      const address = uniqueAddress();

      await register(harness, uniqueEmail('private'), { address });

      const rows = await owner.query<{ address_hash: string }>(
        'select address_hash from registration_counts where address_hash = $1',
        [addressKey(address)],
      );

      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]?.address_hash).not.toContain(address);
    });
  });

  describe.skipIf(!hasAuthRole)('the password policy', () => {
    it('refuses a password under ten characters', async () => {
      const harness = harnessFor(testDb);
      const { answer } = await register(harness, uniqueEmail('short'), {
        password: 'nine char',
        address: uniqueAddress(),
      });

      expect(answer.status).toBe(400);
      expect((answer.body as { code?: string }).code).toBe('weak_password');
    });

    it('refuses a long password that is one of the ones attacked first', async () => {
      const harness = harnessFor(testDb);
      const { answer } = await register(harness, uniqueEmail('common'), {
        password: 'password123',
        address: uniqueAddress(),
      });

      expect(answer.status).toBe(400);
      expect((answer.body as { code?: string }).code).toBe('weak_password');
    });

    it('creates no account when the password is refused', async () => {
      const harness = harnessFor(testDb);
      const email = uniqueEmail('nothing');

      await register(harness, email, { password: 'qwertyuiop', address: uniqueAddress() });

      const rows = await owner.query('select 1 from "user" where email = $1', [email]);

      expect(rows.rowCount).toBe(0);
    });

    it('accepts a long passphrase with no digits or symbols in it', async () => {
      const harness = harnessFor(testDb);
      const { answer } = await register(harness, uniqueEmail('passphrase'), {
        password: 'correcthorsebatterystaple',
        address: uniqueAddress(),
      });

      expect(answer.status).toBe(200);
    });

    it('applies the same rule when the password is being changed', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'changer');

      const refused = await harness.post(
        '/api/auth/change-password',
        { currentPassword: GOOD_PASSWORD, newPassword: 'password123' },
        { jar: person.jar },
      );

      expect(refused.status).toBe(400);
      expect((refused.body as { code?: string }).code).toBe('weak_password');
    });
  });

  describe.skipIf(!hasAuthRole)('the same address twice', () => {
    it('refuses the second one', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'twice');

      const second = await register(harness, person.email, { address: uniqueAddress() });

      expect(second.answer.status).toBeGreaterThanOrEqual(400);
    });

    it('does not charge the address for the account it failed to make', async () => {
      const harness = harnessFor(testDb, { maxRegistrationsPerDay: 2 });
      const address = uniqueAddress();
      const email = uniqueEmail('once');

      await register(harness, email, { address });
      await register(harness, email, { address });

      const rows = await owner.query<{ count: number }>(
        'select count from registration_counts where address_hash = $1',
        [addressKey(address)],
      );

      expect(rows.rows[0]?.count).toBe(1);
    });
  });

  describe.skipIf(!hasAuthRole)('the session cookie', () => {
    it('is httpOnly and SameSite lax', async () => {
      const harness = harnessFor(testDb);
      const jar = new CookieJar();
      const answer = await harness.post(
        '/api/auth/sign-up/email',
        { email: uniqueEmail('cookie'), password: GOOD_PASSWORD, name: 'cookie' },
        { jar, address: uniqueAddress() },
      );

      const setCookie = answer.response.headers
        .getSetCookie()
        .find((header) => header.includes('session_token'));

      expect(setCookie).toBeDefined();
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
    });

    it('is Secure in production', async () => {
      // Only in production, because a Secure cookie is never sent over the
      // plain http a local dev server speaks, and a session that silently does
      // not arrive is a bad afternoon.
      const harness = harnessFor(testDb, { production: true });
      const jar = new CookieJar();
      const answer = await harness.post(
        '/api/auth/sign-up/email',
        { email: uniqueEmail('secure'), password: GOOD_PASSWORD, name: 'secure' },
        { jar, address: uniqueAddress() },
      );

      const setCookie = answer.response.headers
        .getSetCookie()
        .find((header) => header.includes('session_token'));

      expect(setCookie).toMatch(/Secure/i);
    });
  });
});

/**
 * Every value in every table, as one string.
 *
 * @param owner a connection as the database owner
 * @returns everything, concatenated
 */
async function dumpDatabase(owner: Pool): Promise<string> {
  const tables = await owner.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public'",
  );

  const parts: string[] = [];

  for (const { table_name: table } of tables.rows) {
    const rows = await owner.query(`select * from "${table}"`);

    parts.push(JSON.stringify(rows.rows));
  }

  return parts.join('\n');
}
