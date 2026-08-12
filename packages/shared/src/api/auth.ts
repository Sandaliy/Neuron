import { z } from 'zod';

import { newPasswordSchema, passwordSchema } from '../password.js';
import { RECOVERY_CODE_COUNT, normaliseRecoveryCode } from '../recovery-code.js';

/**
 * Signing up, signing in, getting back in, and the second factor.
 *
 * Better Auth owns the endpoints themselves. What lives here is the shape of
 * the bodies that reach them and of the answers that come back, so that the
 * client validates a registration before spending a round trip finding out the
 * password was too short, and so that the generated api description says the
 * same thing the code enforces.
 */

/**
 * An email address, lowercased.
 *
 * Lowercased in the schema rather than in a handler, because the address is
 * both a unique key and a rate limiting key. Two spellings of one address that
 * reach different rows, or different counters, is the kind of thing that is
 * only noticed once somebody is locked out.
 */
export const emailSchema = z
  .email('must be an email address')
  .max(254)
  .transform((value) => value.toLowerCase());

export const registerSchema = z.strictObject({
  email: emailSchema,
  password: newPasswordSchema,
  /** What to call them. Not verified, not unique, changeable later. */
  name: z.string().min(1).max(100),
});

/**
 * What registration answers with.
 *
 * The recovery codes appear here and nowhere else, ever again. They are not
 * stored in a form anybody can read them back out of, so a person who closes
 * this screen without keeping them has to regenerate a new set while they still
 * have their password.
 */
export const registerResultSchema = z.object({
  recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
  /**
   * The translation key for the warning that has to appear next to the codes.
   *
   * A key rather than a sentence: the server has no business choosing between
   * English and Russian, and this particular sentence is the one thing standing
   * between a person and giving their account away.
   */
  warningKey: z.literal('auth.recoveryCodes.warning'),
});

export const signInSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  rememberMe: z.boolean().optional(),
});

/**
 * A recovery code as it arrives from a client.
 *
 * Normalised on the way in, so the hyphens, the spacing and the case a person
 * typed do not decide whether they get back into their account.
 */
export const recoveryCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .transform(normaliseRecoveryCode)
  .refine((code) => code.length > 0, 'is not a recovery code');

/**
 * Signing in with a recovery code.
 *
 * The code is the whole credential. There is no password field here, because
 * the situation this exists for is not having one.
 */
export const recoverySignInSchema = z.strictObject({
  email: emailSchema,
  code: recoveryCodeSchema,
});

export const recoverySignInResultSchema = z.object({
  /** How many codes are left after this one was spent. */
  remaining: z.number().int().min(0),
  /**
   * Always true.
   *
   * A session opened with a recovery code can do exactly one thing: set a new
   * password. Every other route refuses it. The field is here so the client
   * knows to show that screen rather than the library.
   */
  passwordChangeRequired: z.literal(true),
});

/** Choosing the new password the recovery code forced. */
export const completeRecoverySchema = z.strictObject({
  password: newPasswordSchema,
});

/** Asking for a fresh set of codes. Costs the current password. */
export const regenerateRecoveryCodesSchema = z.strictObject({
  password: passwordSchema,
});

export const recoveryCodesStatusSchema = z.object({
  remaining: z.number().int().min(0),
  /** True once the count is low enough to be worth saying out loud. */
  low: z.boolean(),
});

/**
 * Starting TOTP enrollment.
 *
 * Costs the current password, because somebody who walked up to an unlocked
 * laptop should not be able to attach a second factor only they hold.
 */
export const startTotpSchema = z.strictObject({
  password: passwordSchema,
});

export const startTotpResultSchema = z.object({
  /** For the client to render as a QR code. Contains the shared secret. */
  totpUri: z.string(),
  /**
   * The second, separate set of recovery codes.
   *
   * Separate from the account codes on purpose. These are for losing the phone;
   * those are for losing the password. One pile covering both would mean losing
   * the paper costs you both factors at once.
   */
  recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
  warningKey: z.literal('auth.twoFactor.recoveryCodes.warning'),
});

/**
 * A six digit code from an authenticator app.
 *
 * Digits only, and exactly six. A field that accepts anything is a field that
 * sends a mistyped account number to the verifier.
 */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'must be the six digit code from your authenticator app');

/**
 * Confirming enrollment.
 *
 * Until this succeeds the second factor is not active. A QR code that was
 * scanned wrong, or scanned into an app that was then deleted, therefore locks
 * nobody out: the enrollment simply never finished.
 */
export const confirmTotpSchema = z.strictObject({
  code: totpCodeSchema,
});

/** Turning it off. Costs the current password. */
export const disableTotpSchema = z.strictObject({
  password: passwordSchema,
});

/** The second step of signing in, once TOTP is on. */
export const verifyTotpSchema = z.strictObject({
  code: totpCodeSchema,
});

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  /** Codes left in the second pile, the one enrollment issued. */
  remaining: z.number().int().min(0),
});

/**
 * Asking for the verification mail to be sent again.
 *
 * Answers the same way whether or not the address belongs to anybody. A
 * different answer for a known address turns this into a way of asking which
 * addresses have accounts.
 */
export const resendVerificationSchema = z.strictObject({
  email: emailSchema,
});

/** Asking for a password reset link. Same reasoning, same flat answer. */
export const requestPasswordResetSchema = z.strictObject({
  email: emailSchema,
});

/** Using the link. */
export const resetPasswordSchema = z.strictObject({
  token: z.string().min(1).max(512),
  password: newPasswordSchema,
});

/** What every one of the flat answers looks like. */
export const acknowledgedSchema = z.object({
  acknowledged: z.literal(true),
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type RegisterResult = z.infer<typeof registerResultSchema>;
export type SignInBody = z.infer<typeof signInSchema>;
export type RecoverySignInBody = z.infer<typeof recoverySignInSchema>;
export type RecoverySignInResult = z.infer<typeof recoverySignInResultSchema>;
export type CompleteRecoveryBody = z.infer<typeof completeRecoverySchema>;
export type RegenerateRecoveryCodesBody = z.infer<typeof regenerateRecoveryCodesSchema>;
export type RecoveryCodesStatus = z.infer<typeof recoveryCodesStatusSchema>;
export type StartTotpBody = z.infer<typeof startTotpSchema>;
export type StartTotpResult = z.infer<typeof startTotpResultSchema>;
export type ConfirmTotpBody = z.infer<typeof confirmTotpSchema>;
export type DisableTotpBody = z.infer<typeof disableTotpSchema>;
export type VerifyTotpBody = z.infer<typeof verifyTotpSchema>;
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;
export type ResendVerificationBody = z.infer<typeof resendVerificationSchema>;
export type RequestPasswordResetBody = z.infer<typeof requestPasswordResetSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
