import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RECOVERY_CODE_COUNT } from '@neuron/shared';

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
 * Getting back into an account with a recovery code.
 *
 * The whole point of this path is that it works when nothing else does, so it
 * is tested against the real thing: real argon2 hashes, a real cookie, and the
 * real sessions it is supposed to close.
 *
 * The database is shared with every other file in the run and is never emptied
 * here, so every person is minted fresh and every query is scoped to one of
 * them.
 */

const database = testDatabase();

describe.skipIf(!database)('recovery codes', () => {
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

  describe.skipIf(!hasAuthRole)('signing in with one', () => {
    it('lets somebody in who has forgotten their password', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'lost');

      const used = await harness.post<{ remaining: number; passwordChangeRequired: boolean }>(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(used.status).toBe(200);
      expect(used.body.passwordChangeRequired).toBe(true);
      expect(used.body.remaining).toBe(RECOVERY_CODE_COUNT - 1);
    });

    it('accepts the code however it was typed back in', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'typing');

      // Lowercased, with spaces where the hyphens were. A person reading it off
      // paper into a phone keyboard produces exactly this.
      const asTyped = (person.recoveryCodes[0] as string).toLowerCase().replaceAll('-', ' ');

      const used = await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: asTyped },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(used.status).toBe(200);
    });

    it('refuses the same code a second time', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'twice');
      const code = person.recoveryCodes[0];

      const first = await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code },
        { jar: new CookieJar(), address: uniqueAddress() },
      );
      const second = await harness.post<{ code?: string }>(
        '/api/auth/recovery/sign-in',
        { email: person.email, code },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(401);
      expect(second.body.code).toBe('invalid_recovery_code');
    });

    it('leaves nine when one has been spent', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'nine');
      const jar = new CookieJar();

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar, address: uniqueAddress() },
      );
      await harness.post(
        '/api/auth/recovery/complete',
        { password: 'a-new-passphrase-here' },
        { jar },
      );

      const status = await harness.get<{ remaining: number; low: boolean }>(
        '/api/auth/recovery/status',
        { jar },
      );

      expect(status.body.remaining).toBe(RECOVERY_CODE_COUNT - 1);
      expect(status.body.low).toBe(false);
    });

    it('refuses a code that belongs to somebody else', async () => {
      const harness = harnessFor(testDb);
      const mine = await registerFresh(harness, 'mine');
      const yours = await registerFresh(harness, 'yours');

      const stolen = await harness.post(
        '/api/auth/recovery/sign-in',
        { email: yours.email, code: mine.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(stolen.status).toBe(401);
    });

    it('answers the same way for an address that has no account', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'real');

      const unknown = await harness.post<{ code?: string }>(
        '/api/auth/recovery/sign-in',
        { email: uniqueEmail('nobody'), code: person.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      // The same status and the same code as a wrong code on a real account.
      // A different answer here would turn this endpoint into a way of asking
      // which addresses have accounts.
      expect(unknown.status).toBe(401);
      expect(unknown.body.code).toBe('invalid_recovery_code');
    });

    it('closes every session the account had open', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'sessions');

      // Two devices, both signed in and both working.
      const phone = (await signIn(harness, person.email)).jar;
      const laptop = (await signIn(harness, person.email)).jar;

      expect((await harness.get('/api/account', { jar: phone })).status).toBe(200);
      expect((await harness.get('/api/account', { jar: laptop })).status).toBe(200);

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      // Somebody reaching for a recovery code thinks they have lost control of
      // the account. Leaving the other devices signed in would do nothing about
      // the thing they are worried about.
      expect((await harness.get('/api/account', { jar: phone })).status).toBe(401);
      expect((await harness.get('/api/account', { jar: laptop })).status).toBe(401);
    });
  });

  describe.skipIf(!hasAuthRole)('the session a code opens', () => {
    it('cannot do anything except choose a password', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'halfway');
      const jar = new CookieJar();

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar, address: uniqueAddress() },
      );

      const account = await harness.get<{ error?: { code: string } }>('/api/account', { jar });
      const decks = await harness.get('/api/decks', { jar });

      expect(account.status).toBe(403);
      expect(account.body.error?.code).toBe('password_change_required');
      expect(decks.status).toBe(403);
    });

    it('becomes an ordinary session once the password is set', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'finished');
      const jar = new CookieJar();

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar, address: uniqueAddress() },
      );

      const completed = await harness.post(
        '/api/auth/recovery/complete',
        { password: 'a-brand-new-passphrase' },
        { jar },
      );

      expect(completed.status).toBe(200);
      expect((await harness.get('/api/account', { jar })).status).toBe(200);
    });

    it('refuses a new password that would not have been allowed at registration', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'weaknew');
      const jar = new CookieJar();

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar, address: uniqueAddress() },
      );

      const refused = await harness.post<{ code?: string }>(
        '/api/auth/recovery/complete',
        { password: 'password123' },
        { jar },
      );

      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('weak_password');
      // Still stuck on the same screen, rather than let through with the weak
      // password quietly not applied.
      expect((await harness.get('/api/account', { jar })).status).toBe(403);
    });

    it('leaves the new password working and the old one not', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'swapped');
      const jar = new CookieJar();

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar, address: uniqueAddress() },
      );
      await harness.post(
        '/api/auth/recovery/complete',
        { password: 'the-second-passphrase' },
        { jar },
      );

      const withOld = await signIn(harness, person.email, GOOD_PASSWORD);
      const withNew = await signIn(harness, person.email, 'the-second-passphrase');

      expect(withOld.answer.status).toBeGreaterThanOrEqual(400);
      expect(withNew.answer.status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('generating a new set', () => {
    it('needs the current password', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'regen');

      const wrong = await harness.post(
        '/api/auth/recovery/regenerate',
        { password: 'not-the-right-password' },
        { jar: person.jar },
      );

      expect(wrong.status).toBeGreaterThanOrEqual(400);
    });

    it('replaces every code that came before', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'replaced');
      const old = person.recoveryCodes[0];

      const fresh = await harness.post<{ recoveryCodes: string[]; warningKey: string }>(
        '/api/auth/recovery/regenerate',
        { password: GOOD_PASSWORD },
        { jar: person.jar },
      );

      expect(fresh.status).toBe(200);
      expect(fresh.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(fresh.body.warningKey).toBe('auth.recoveryCodes.warning');
      expect(fresh.body.recoveryCodes).not.toContain(old);

      // The old one has to stop working immediately. A set that is replaced but
      // still accepted is not a replacement.
      const withOld = await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: old },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      expect(withOld.status).toBe(401);
    });

    it('brings the count back to ten', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'refilled');

      // Spend one, then refill.
      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      const back = await signIn(harness, person.email);

      await harness.post(
        '/api/auth/recovery/regenerate',
        { password: GOOD_PASSWORD },
        { jar: back.jar },
      );

      const status = await harness.get<{ remaining: number }>('/api/auth/recovery/status', {
        jar: back.jar,
      });

      expect(status.body.remaining).toBe(RECOVERY_CODE_COUNT);
    });

    it('needs a session at all', async () => {
      const harness = harnessFor(testDb);

      await registerFresh(harness, 'stranger');

      const anonymous = await harness.post(
        '/api/auth/recovery/regenerate',
        { password: GOOD_PASSWORD },
        { jar: new CookieJar() },
      );

      expect(anonymous.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe.skipIf(!hasAuthRole)('running out', () => {
    it('says so plainly rather than pretending the last code was wrong', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'empty');

      // One spent through the api, and the rest marked spent directly.
      //
      // Not laziness. Ten sign in attempts against one account inside a minute
      // is over the per account rate limit, which is the limit working: that is
      // what a script trying codes looks like. Driving the whole set through
      // the endpoint would be testing the limiter, which has its own tests, and
      // would say nothing extra about what happens when the last code is gone.
      const jar = new CookieJar();

      await harness.post(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[0] },
        { jar, address: uniqueAddress() },
      );
      await harness.post('/api/auth/recovery/complete', { password: GOOD_PASSWORD }, { jar });

      await owner.query(
        'update recovery_codes set used_at = now() where user_id = $1 and used_at is null',
        [person.userId],
      );

      const exhausted = await harness.post<{ code?: string }>(
        '/api/auth/recovery/sign-in',
        { email: person.email, code: person.recoveryCodes[9] },
        { jar: new CookieJar(), address: uniqueAddress() },
      );

      // A different code from a wrong guess, because the answer is different:
      // there is nothing left to guess, and the only way back is the admin
      // script. Telling somebody to keep trying would be a lie.
      expect(exhausted.status).toBe(403);
      expect(exhausted.body.code).toBe('no_recovery_codes');
    });
  });
});
