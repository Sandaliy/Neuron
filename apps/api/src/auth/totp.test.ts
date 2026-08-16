import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RECOVERY_CODE_COUNT } from '@neuron/shared';

import { describeAuthSkipReason, rawOwnerPool, testDatabase } from '../db/testing/database.js';

import {
  GOOD_PASSWORD,
  harnessFor,
  currentStep,
  registerFresh,
  signIn,
  totpCodeFor,
} from './testing/harness.js';

import type { CookieJar, Harness } from './testing/harness.js';
import type { TestDatabase } from '../db/testing/database.js';
import type { Pool } from '@neondatabase/serverless';

/**
 * The optional second factor.
 *
 * Two things decide whether this is worth having. It must not be possible to
 * lock yourself out by scanning the QR code badly, and it must not be possible
 * to lose the account by losing the phone. Everything else here is detail.
 *
 * The database is shared with every other file in the run and is never emptied
 * here, so every person is minted fresh and every query is scoped to one of
 * them.
 */

const database = testDatabase();

/** What enrollment hands back. */
interface Enrollment {
  totpURI: string;
  backupCodes: string[];
}

/** Somebody who has scanned the QR code but not yet confirmed it. */
interface Enrolling {
  readonly jar: CookieJar;
  readonly enrollment: Enrollment;
  readonly userId: string;
  readonly email: string;
}

describe.skipIf(!database)('two step sign in', () => {
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

  /** Registers somebody and gets as far as the QR code, without confirming. */
  async function startEnrollment(harness: Harness, label: string): Promise<Enrolling> {
    const person = await registerFresh(harness, label);
    const answer = await harness.post<Enrollment>(
      '/api/auth/two-factor/enable',
      { password: GOOD_PASSWORD },
      { jar: person.jar },
    );

    if (answer.status !== 200) {
      throw new Error(`enrollment failed: ${answer.status} ${JSON.stringify(answer.body)}`);
    }

    return {
      jar: person.jar,
      enrollment: answer.body,
      userId: person.userId,
      email: person.email,
    };
  }

  /** Whether this account's second factor has been confirmed. */
  async function isVerified(userId: string): Promise<boolean | undefined> {
    const row = await owner.query<{ verified: boolean }>(
      'select verified from two_factor where user_id = $1',
      [userId],
    );

    return row.rows[0]?.verified;
  }

  describe.skipIf(!hasAuthRole)('turning it on', () => {
    it('needs the current password', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'nopassword');

      const refused = await harness.post(
        '/api/auth/two-factor/enable',
        { password: 'not-the-password' },
        { jar: person.jar },
      );

      expect(refused.status).toBeGreaterThanOrEqual(400);
    });

    it('hands back something an authenticator app can read', async () => {
      const harness = harnessFor(testDb);
      const { enrollment } = await startEnrollment(harness, 'qr');

      const uri = new URL(enrollment.totpURI);

      expect(uri.protocol).toBe('otpauth:');
      expect(uri.searchParams.get('secret')).toBeTruthy();
      expect(uri.searchParams.get('digits')).toBe('6');
      expect(uri.searchParams.get('period')).toBe('30');
    });

    it('hands back a second pile of recovery codes', async () => {
      const harness = harnessFor(testDb);
      const { enrollment } = await startEnrollment(harness, 'phonecodes');

      // The point of the whole feature. Without these, changing your phone is
      // the same as losing the account.
      expect(enrollment.backupCodes).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('issues codes separate from the account recovery codes', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'separate');
      const account = await harness.post<{ recoveryCodes: string[] }>(
        '/api/auth/recovery/regenerate',
        { password: GOOD_PASSWORD },
        { jar: person.jar },
      );
      const enrolled = await harness.post<Enrollment>(
        '/api/auth/two-factor/enable',
        { password: GOOD_PASSWORD },
        { jar: person.jar },
      );

      // Two piles, for two different disasters: losing the password, and
      // losing the phone. One pile covering both would mean losing the paper
      // costs you both factors at once.
      for (const code of enrolled.body.backupCodes) {
        expect(account.body.recoveryCodes).not.toContain(code);
      }
    });

    it('is not on until a code from the app has been typed in', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'unconfirmed');

      // The QR code was shown but never scanned, or was scanned into an app
      // that has since been deleted. Signing in has to keep working, or the
      // feature is a way of losing accounts.
      const { answer, jar } = await signIn(harness, enrolling.email);

      expect(answer.status).toBe(200);
      expect((await harness.get('/api/account', { jar })).status).toBe(200);
      expect(await isVerified(enrolling.userId)).toBe(false);
    });

    it('is on once a code from the app has been typed in', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'confirmed');

      const confirmed = await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );

      expect(confirmed.status).toBe(200);
      expect(await isVerified(enrolling.userId)).toBe(true);

      // And now signing in stops at the password.
      const { answer } = await signIn(harness, enrolling.email);

      expect(answer.status).toBe(200);
      expect((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    });

    /**
     * The account has to say which of the two states it is in.
     *
     * Settings offered "Set up two-factor authentication" and "Turn off 2FA" at
     * the same time, whatever the account, because nothing it could read said
     * which one applied.
     */
    it('reports on the account whether it is on', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'reported');

      const before = await harness.get<{ twoFactorEnabled: boolean }>('/api/account', {
        jar: enrolling.jar,
      });

      expect(before.status).toBe(200);
      // Enrolment started and not confirmed is still off. Until the code comes
      // back the account is exactly as it was.
      expect(before.body.twoFactorEnabled).toBe(false);

      const confirmed = await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );

      expect(confirmed.status).toBe(200);

      const after = await harness.get<{ twoFactorEnabled: boolean }>('/api/account', {
        jar: enrolling.jar,
      });

      expect(after.body.twoFactorEnabled).toBe(true);
    });

    it('refuses a wrong code, and stays off', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'wrongcode');

      const refused = await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: '000000' },
        { jar: enrolling.jar },
      );

      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await isVerified(enrolling.userId)).toBe(false);
    });
  });

  describe.skipIf(!hasAuthRole)('the codes themselves', () => {
    it('accepts one step of clock skew either way', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'skew');

      await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI, currentStep() - 1) },
        { jar: enrolling.jar },
      );

      // A phone whose clock is half a minute behind still works, which is the
      // whole reason a window exists.
      expect(await isVerified(enrolling.userId)).toBe(true);
    });

    it('refuses two steps of skew', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'faraway');

      const refused = await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI, currentStep() - 2) },
        { jar: enrolling.jar },
      );

      // Two would double the time a stolen code stays useful, in exchange for
      // tolerating a clock that is a minute out. A clock a minute out has a
      // problem worth fixing.
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await isVerified(enrolling.userId)).toBe(false);
    });

    it('refuses a code that has already been used', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'replay');
      const code = await totpCodeFor(enrolling.enrollment.totpURI);

      const first = await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code },
        { jar: enrolling.jar },
      );
      const second = await harness.post<{ code?: string }>(
        '/api/auth/two-factor/verify-totp',
        { code },
        { jar: enrolling.jar },
      );

      expect(first.status).toBe(200);

      // The same code, still inside its window, and still refused. Without
      // this, a code read over somebody's shoulder keeps working for another
      // minute and a half.
      expect(second.status).toBe(401);
      expect(second.body.code).toBe('two_factor_code_reused');
    });

    it('refuses an older code once a newer one has been accepted', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'older');

      await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );

      const older = await harness.post<{ code?: string }>(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI, currentStep() - 1) },
        { jar: enrolling.jar },
      );

      // Anything at or below the last accepted step, not just the exact code.
      expect(older.status).toBe(401);
      expect(older.body.code).toBe('two_factor_code_reused');
    });

    it('remembers the step it accepted', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'stepped');

      await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );

      const row = await owner.query<{ last_totp_step: string }>(
        'select last_totp_step from two_factor where user_id = $1',
        [enrolling.userId],
      );

      expect(Number(row.rows[0]?.last_totp_step)).toBe(currentStep());
    });
  });

  describe.skipIf(!hasAuthRole)('signing in with it on', () => {
    /** Registers, enrolls, confirms, and signs back out. */
    async function enrolled(harness: Harness, label: string): Promise<Enrolling> {
      const enrolling = await startEnrollment(harness, label);

      await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );
      await harness.post('/api/auth/sign-out', {}, { jar: enrolling.jar });

      return enrolling;
    }

    it('is not finished until the code is given', async () => {
      const harness = harnessFor(testDb);
      const person = await enrolled(harness, 'twostep');

      const { answer, jar } = await signIn(harness, person.email);

      expect(answer.status).toBe(200);
      expect((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);

      // The password alone opens nothing.
      expect((await harness.get('/api/account', { jar })).status).toBe(401);
    });

    it('finishes when the code is given', async () => {
      const harness = harnessFor(testDb);
      const person = await enrolled(harness, 'finish');
      const { jar } = await signIn(harness, person.email);

      // A step forward, because the code that confirmed enrollment has already
      // been spent and the guard refuses anything at or below it.
      const second = await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(person.enrollment.totpURI, currentStep() + 1) },
        { jar },
      );

      expect(second.status).toBe(200);
      expect((await harness.get('/api/account', { jar })).status).toBe(200);
    });

    it('finishes with a code for a lost phone instead', async () => {
      const harness = harnessFor(testDb);
      const person = await enrolled(harness, 'lostphone');
      const { jar } = await signIn(harness, person.email);

      const used = await harness.post(
        '/api/auth/two-factor/verify-backup-code',
        { code: person.enrollment.backupCodes[0] },
        { jar },
      );

      expect(used.status).toBe(200);
      expect((await harness.get('/api/account', { jar })).status).toBe(200);
    });
  });

  describe.skipIf(!hasAuthRole)('turning it off', () => {
    it('needs the current password', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'keepon');

      await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );

      const refused = await harness.post(
        '/api/auth/two-factor/disable',
        { password: 'not-the-password' },
        { jar: enrolling.jar },
      );

      expect(refused.status).toBeGreaterThanOrEqual(400);

      const row = await owner.query<{ two_factor_enabled: boolean }>(
        'select two_factor_enabled from "user" where id = $1',
        [enrolling.userId],
      );

      expect(row.rows[0]?.two_factor_enabled).toBe(true);
    });

    it('works with it', async () => {
      const harness = harnessFor(testDb);
      const enrolling = await startEnrollment(harness, 'turnoff');

      await harness.post(
        '/api/auth/two-factor/verify-totp',
        { code: await totpCodeFor(enrolling.enrollment.totpURI) },
        { jar: enrolling.jar },
      );

      const disabled = await harness.post(
        '/api/auth/two-factor/disable',
        { password: GOOD_PASSWORD },
        { jar: enrolling.jar },
      );

      expect(disabled.status).toBe(200);

      // And signing in is one step again.
      const { answer } = await signIn(harness, enrolling.email);

      expect((answer.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
    });
  });

  describe.skipIf(!hasAuthRole)('what it is not', () => {
    it('is not required of anybody', async () => {
      const harness = harnessFor(testDb);
      const person = await registerFresh(harness, 'plain');

      // Never enrolled, and everything works. Nothing in the application may
      // require a second factor.
      expect((await harness.get('/api/account', { jar: person.jar })).status).toBe(200);
      expect((await harness.get('/api/decks', { jar: person.jar })).status).toBe(200);
    });
  });
});
