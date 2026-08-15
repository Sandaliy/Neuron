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
  'auth.password.show': 'Show the password',
  'auth.password.hide': 'Hide the password',

  'auth.password.strength.fair':
    'Long enough. Another few characters, or one more word, is the easiest way to make it stronger.',
  'auth.password.strength.good': 'Good length. Another word would make it harder still.',
  'auth.password.strength.strong': 'Long enough that length is no longer the weak part.',
  'auth.password.confirmLabel': 'Type the password again',
  'auth.password.confirmMatch': 'Both fields match.',
  'auth.password.confirmMismatch': 'The two passwords are different.',
  'auth.password.confirmHint':
    'There is no email recovery here, so a password typed wrong twice cannot be undone.',

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

  'auth.twoFactor.title': 'Two-factor authentication',
  'auth.twoFactor.subtitle':
    'Optional. Adds a six digit code from an app on your phone to every sign in.',
  'auth.twoFactor.enable': 'Turn on 2FA',
  'auth.twoFactor.disable': 'Turn off 2FA',
  'auth.twoFactor.scan': 'Scan this with your authenticator app.',
  'auth.twoFactor.confirmHint': 'Type the code the app shows. Until you do, 2FA is not on.',
  'auth.twoFactor.codeLabel': 'Six digit code',
  'auth.twoFactor.invalid': 'That code is not right.',
  'auth.twoFactor.reused': 'That code has already been used. Wait for the app to show a new one.',
  'auth.twoFactor.unavailable': '2FA is not set up on this account.',
  'auth.twoFactor.enabled': '2FA is on.',
  'auth.twoFactor.disabled': '2FA is off.',
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

  'app.name': 'Neuron',
  'app.tagline': 'Spaced repetition that schedules your time, not your card count',

  'nav.today': 'Today',
  'nav.library': 'Library',
  'nav.settings': 'Settings',

  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.retry': 'Try again',
  'common.loading': 'Loading',
  'common.signOut': 'Sign out',

  'auth.email.label': 'Email',
  'auth.signIn.noAccount': 'No account yet? Create one.',
  'auth.signIn.recover': 'Sign in with a recovery code',
  'auth.register.haveAccount': 'Already have an account? Sign in.',
  'auth.recoveryCodes.fileName': 'neuron-recovery-codes.txt',
  'auth.twoFactor.secretLabel': 'Cannot scan it? Type this into the app instead.',
  'auth.twoFactor.password': 'Your password',
  'auth.twoFactor.passwordHint': 'Asked for because turning this on issues new codes.',

  'auth.twoFactor.setUp': 'Set up two-factor authentication',
  'auth.twoFactor.manualTitle': 'Enter the key by hand instead',
  'auth.twoFactor.manualHint':
    'Paste this key into your authenticator app under "add account by key". It is the same account the QR code sets up, so use one or the other, not both.',
  'auth.twoFactor.secretCopy': 'Copy the setup key',
  'auth.twoFactor.secretCopied': 'Setup key copied',
  'settings.changePasswordAction': 'Change your password',
  'settings.regenerateAction': 'Replace your recovery codes',
  'settings.deleteAccountAction': 'Delete this account and everything in it',

  'today.title': 'Today',
  'today.waitingIn': 'Waiting in',
  'today.waitingLabel': 'cards to review',
  'today.newLabel': 'new',
  'today.deckCounts': '{due} to review · {fresh} new',
  'today.waiting': 'Cards waiting: {count}',
  'today.newAvailable': 'New cards ready to start: {count}',
  'today.newAvailableHint':
    'How many of them a session actually introduces is decided when studying starts, from how much time the reviews already need.',
  'today.estimate': 'About {minutes} minutes',
  'today.estimateHint':
    'Worked out from a typical answer time. It turns into a real measurement once there are a few days of answers to measure.',
  'today.study': 'Study',
  'today.studyLater': 'The study screen is not built yet. It arrives in phase 7.',
  'today.emptyTitle': 'Nothing is waiting',
  'today.emptyBody': 'Cards appear here on the day they are due.',

  'library.title': 'Library',
  'library.dueLabel': 'Cards waiting',
  'library.newLabel': 'Cards never answered',
  'library.expand': 'Show what is inside',
  'library.collapse': 'Hide what is inside',
  'library.emptyTitle': 'No decks yet',
  'library.emptyBody':
    'Decks show up here as soon as there are any. Making them arrives in phase 6.',
  'library.readOnly': 'Reading only for now. Making and moving decks arrives in phase 6.',

  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.system': 'System',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.language': 'Language',
  'settings.glass': 'Liquid glass',
  'settings.glass.off': 'Off',
  'settings.glass.subtle': 'Medium',
  'settings.glass.full': 'Max',
  'settings.glassHint': 'Turn this down if scrolling stutters on your phone.',
  'settings.glassScope': 'Where it applies',
  'settings.glassScope.floating': 'Panels only',
  'settings.glassScope.all': 'Panels and cards',
  'settings.glassScopeHint':
    'Cards and rows are content, and glass on every one of them is paid for on every scrolled frame.',
  'settings.glassScopeOff': 'Nothing to apply it to while the glass is off.',
  'settings.glassCapped.motion':
    'Your system asks for less movement, so the panels are running at Medium.',
  'settings.glassCapped.memory':
    'This device reports little memory, so the panels are running at Medium.',
  'settings.glassCapped.frames':
    'Scrolling dropped below 55 frames a second here, so the panels stepped down. Reload to try the full setting again.',
  'settings.motion': 'Less movement',
  'settings.motion.system': 'Follow the system',
  'settings.motion.reduce': 'Off',
  'settings.motionHint': 'Nothing slides or fades. States still change, they just change at once.',
  'settings.security': 'Security',
  'settings.changePassword': 'Change password',
  'settings.currentPassword': 'Current password',
  'settings.newPassword': 'New password',
  'settings.passwordChanged': 'Password changed. Everywhere else has been signed out.',
  'settings.account': 'Account',
  'settings.deleteAccount': 'Delete account',
  'settings.deleteAccountWarning':
    'This closes the account and takes the decks, the notes and the whole review history with it. The rows are erased for good after thirty days, and nothing inside the app can stop that once it has started.',
  'settings.deleteAccountConfirm': 'Type the words below to confirm',
  'settings.deleteAccountPhrase': 'delete my account',
  'settings.deleted': 'The account is closed.',

  'error.not_authenticated': 'Sign in to continue.',
  'error.not_allowed': 'That action was refused. Reload the page and try again.',
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
  'error.two_factor_unavailable': '2FA is not set up on this account.',
  'error.invalid_token': 'That link is not valid any more. Ask for a new one.',
  'error.direction_unavailable': 'That card direction is not available.',
  'error.sync_rejected': 'Those changes could not be saved. They are still on this device.',
  'error.service_unavailable': 'The server is not answering. Your work is saved on this device.',
  'error.network_unreachable':
    'This device cannot reach the server. Check the connection and try again. Your work is saved here.',
  'error.untrusted_origin':
    'The server does not recognise this web address. Open the app at its usual address and sign in there.',
  'error.unexpected': 'Something went wrong. Try again in a moment.',
  'error.internal_error':
    'Something went wrong at our end. Try again in a moment, and quote this if it keeps happening: {correlationId}',
} as const;

/** Every key the interface can ask for. */
export type MessageKey = keyof typeof en;

/** A catalogue in one language. Every key, no exceptions. */
export type Messages = Record<MessageKey, string>;
