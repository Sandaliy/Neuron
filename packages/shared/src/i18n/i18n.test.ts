import { describe, expect, it } from 'vitest';

import { API_ERROR_CODES } from '../api/errors.js';
import { LOCALES } from '../preferences.js';

import { CATALOGUES, en, ru, translate } from './index.js';

describe('the message catalogues', () => {
  it('covers every language the app claims to be in', () => {
    for (const locale of LOCALES) {
      expect(CATALOGUES[locale]).toBeDefined();
    }
  });

  it('has the same keys in both languages', () => {
    // The types already say so. This says so at run time as well, because the
    // Russian catalogue is the one a type assertion could silently widen.
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('leaves no message empty in either language', () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const [key, message] of Object.entries(catalogue)) {
        expect(message.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('has a sentence for every error code the api can send', () => {
    // A code with no message reaches a person as a blank space, and the api is
    // free to send any of these at any time.
    for (const code of API_ERROR_CODES) {
      expect(en[`error.${code}`], code).toBeDefined();
      expect(ru[`error.${code}`], code).toBeDefined();
    }
  });

  it('says plainly that a recovery code is the whole credential', () => {
    // The one sentence the scheme rests on. If it ever softens into "keep
    // these safe", the person filing them in an email to themselves has been
    // told the wrong thing.
    expect(en['auth.recoveryCodes.warning']).toContain('take over your account');
    expect(en['auth.recoveryCodes.warning']).toContain('without your password');
    expect(ru['auth.recoveryCodes.warning']).toContain('без пароля');
  });

  it('says the two factor codes are the answer to a lost phone', () => {
    expect(en['auth.twoFactor.recoveryCodes.warning']).toContain('lost phone');
    expect(ru['auth.twoFactor.recoveryCodes.warning']).toContain('телефон');
  });
});

describe('filling in a message', () => {
  it('substitutes a placeholder', () => {
    expect(translate('en', 'error.rate_limited', { seconds: 30 })).toBe(
      'Too many tries. Wait 30 seconds.',
    );
  });

  it('answers in the language asked for', () => {
    expect(translate('ru', 'error.rate_limited', { seconds: 30 })).toBe(
      'Слишком много попыток. Подождите 30 секунд.',
    );
  });

  it('leaves a placeholder nobody supplied visible', () => {
    // Visible, because "Wait  seconds" looks like the person broke something
    // and "Wait {seconds} seconds" looks like we did. The second is true.
    expect(translate('en', 'error.rate_limited')).toContain('{seconds}');
  });

  it('needs no values for a message that has no placeholders', () => {
    expect(translate('en', 'auth.signIn.submit')).toBe('Sign in');
  });
});
