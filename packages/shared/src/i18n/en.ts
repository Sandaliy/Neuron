/**
 * English. The reference catalogue: `ru` is typed against this one, so a key
 * added here and forgotten there does not compile.
 */
export const en = {
  'auth.register.title': 'Create an account',
  'auth.register.submit': 'Create account',
  'auth.register.closed':
    'New accounts are closed right now. If you already have one, you can still sign in.',

  'auth.password.label': 'Password',
  'auth.password.tooShort': 'Use at least 10 characters.',
  'auth.password.tooLong': 'That is longer than 200 characters.',
  'auth.password.tooCommon':
    'That is one of the first passwords an attacker tries. Pick something else.',
  'auth.password.hint': 'At least 10 characters. Length matters more than symbols.',

  'auth.signIn.title': 'Sign in',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.failed': 'That email and password do not go together.',
  'auth.signIn.forgot': 'Lost your password?',

  'auth.recoveryCodes.title': 'Your recovery codes',
  /**
   * The sentence the whole scheme rests on.
   *
   * There is no mail sender yet, so a recovery code is not a step towards
   * getting back in, it is the way in. Saying that plainly is the difference
   * between a person keeping the codes like a password and keeping them in a
   * note on their phone.
   */
  'auth.recoveryCodes.warning':
    'Anyone holding one of these codes can take over your account without your password. Keep them the way you would keep the password itself: written down somewhere private, or in a password manager. We cannot show them to you again.',
  'auth.recoveryCodes.subtitle':
    'Ten codes. Each one works once. They are the only way back into this account if you forget your password.',
  'auth.recoveryCodes.copy': 'Copy codes',
  'auth.recoveryCodes.copied': 'Copied',
  'auth.recoveryCodes.download': 'Download codes',
  'auth.recoveryCodes.confirm': 'I have saved them',
  'auth.recoveryCodes.remaining': 'Recovery codes left: {count}',
  'auth.recoveryCodes.low': 'Only {count} recovery codes left. Generate a new set.',
  'auth.recoveryCodes.none':
    'No recovery codes left. Generate a new set now, while you still know your password.',
  'auth.recoveryCodes.regenerate': 'Generate new codes',
  'auth.recoveryCodes.regenerateWarning':
    'This replaces every code you have. The old ones stop working immediately.',

  'auth.recovery.title': 'Sign in with a recovery code',
  'auth.recovery.hint': 'Type one of the codes you saved when you created the account.',
  'auth.recovery.invalid': 'That code is not right, or it has already been used.',
  'auth.recovery.exhausted':
    'Every recovery code for this account has been used. Get in touch so it can be reset by hand.',
  'auth.recovery.setPassword': 'Choose a new password',
  'auth.recovery.setPasswordHint':
    'The code has been used up. Choose a new password to finish signing in.',
  'auth.recovery.signedOutElsewhere': 'Everywhere else has been signed out.',

  'auth.twoFactor.title': 'Two step sign in',
  'auth.twoFactor.subtitle':
    'Optional. Adds a six digit code from an app on your phone to every sign in.',
  'auth.twoFactor.enable': 'Turn on',
  'auth.twoFactor.disable': 'Turn off',
  'auth.twoFactor.scan': 'Scan this with your authenticator app.',
  'auth.twoFactor.confirmHint':
    'Type the code the app shows. Until you do, two step sign in is not on.',
  'auth.twoFactor.codeLabel': 'Six digit code',
  'auth.twoFactor.invalid': 'That code is not right.',
  'auth.twoFactor.reused': 'That code has already been used. Wait for the app to show a new one.',
  'auth.twoFactor.unavailable': 'Two step sign in is not set up on this account.',
  'auth.twoFactor.enabled': 'Two step sign in is on.',
  'auth.twoFactor.disabled': 'Two step sign in is off.',
  /** The one that matters. Losing a phone must not mean losing the account. */
  'auth.twoFactor.recoveryCodes.warning':
    'These ten codes are separate from your account recovery codes, and they exist for one reason: getting in when you no longer have your phone. Save them now. Without them, a lost phone means a lost account.',
  'auth.twoFactor.recoveryCodes.title': 'Codes for a lost phone',

  'auth.email.verifyTitle': 'Confirm your email',
  'auth.email.verifySent': 'If that address has an account, a link is on its way.',
  'auth.email.verifyRequired': 'Confirm your email address to start using the app.',
  'auth.email.resend': 'Send it again',
  'auth.email.verified': 'Email confirmed.',
  'auth.email.invalidToken': 'That link is not valid any more. Ask for a new one.',

  'auth.reset.title': 'Reset your password',
  'auth.reset.sent': 'If that address has an account, a link is on its way.',
  'auth.reset.done': 'Password changed. Everywhere else has been signed out.',

  'error.not_authenticated': 'Sign in to continue.',
  'error.not_allowed': 'You cannot do that.',
  'error.not_found': 'That is not here.',
  'error.invalid_request': 'Something in that request was not right.',
  'error.name_taken': 'That name is already used here.',
  'error.deck_cycle': 'A deck cannot be moved inside itself.',
  'error.unknown_note_type': 'That note type does not exist.',
  'error.invalid_note_fields': 'Those fields do not match the note type.',
  'error.rate_limited': 'Too many tries. Wait {seconds} seconds.',
  'error.registration_closed':
    'New accounts are closed right now. If you already have one, you can still sign in.',
  'error.weak_password': 'Pick a longer or less common password.',
  'error.email_taken': 'That address already has an account.',
  'error.invalid_credentials': 'That email and password do not go together.',
  'error.invalid_recovery_code': 'That code is not right, or it has already been used.',
  'error.no_recovery_codes': 'No recovery codes are left on this account.',
  'error.password_change_required': 'Choose a new password to finish signing in.',
  'error.email_not_verified': 'Confirm your email address first.',
  'error.two_factor_required': 'Type the code from your authenticator app.',
  'error.invalid_two_factor_code': 'That code is not right.',
  'error.two_factor_code_reused': 'That code has already been used. Wait for a new one.',
  'error.two_factor_unavailable': 'Two step sign in is not set up on this account.',
  'error.invalid_token': 'That link is not valid any more. Ask for a new one.',
  'error.direction_unavailable': 'That card direction is not available.',
  'error.sync_rejected': 'Those changes could not be saved. They are still on this device.',
  'error.service_unavailable': 'The server is not answering. Your work is saved on this device.',
  'error.internal_error': 'Something went wrong at our end. Reference: {correlationId}',
} as const;

/** Every key the interface can ask for. */
export type MessageKey = keyof typeof en;

/** A catalogue in one language. Every key, no exceptions. */
export type Messages = Record<MessageKey, string>;
