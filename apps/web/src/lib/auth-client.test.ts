import { describe, expect, it } from 'vitest';

import { describeAuthError } from './auth-client';

/**
 * Better Auth answers in its own vocabulary, and half of it has no obvious
 * translation. What this mapping decides is the sentence somebody reads when
 * they cannot get in, which is the moment they most need to be told the truth.
 */
describe('describing an authentication failure', () => {
  it('names the reason when the server gave one', () => {
    expect(describeAuthError({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 }).key).toBe(
      'error.invalid_credentials',
    );
  });

  it('speaks Neuron\'s own codes without translating them twice', () => {
    expect(describeAuthError({ code: 'registration_closed', status: 403 }).key).toBe(
      'error.registration_closed',
    );
  });

  it('tells the address refusal apart from a password that was wrong', () => {
    /*
     * The failure this mapping was rewritten for. Better Auth refuses the
     * request before the password is looked at, and every one of these names
     * means the same thing: the page is at an address the api does not trust.
     *
     * It used to fall through to the 403 branch and reach the screen as "You
     * cannot do that", which is how a deployment mistake spent an evening
     * looking like a forgotten password.
     */
    for (const code of [
      'INVALID_ORIGIN',
      'MISSING_OR_NULL_ORIGIN',
      'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
    ]) {
      expect(describeAuthError({ code, status: 403 }).key).toBe('error.untrusted_origin');
    }
  });

  it('says the request never left the device, rather than blaming the server', () => {
    expect(describeAuthError({ code: 'NETWORK_UNREACHABLE', status: 599 }).key).toBe(
      'error.network_unreachable',
    );
  });

  it('hands over the reference when nothing on either list matches', () => {
    const described = describeAuthError({
      code: 'SOMETHING_NOBODY_MAPPED',
      status: 400,
      correlationId: '01a006aa-7e9a-7000',
    });

    expect(described.key).toBe('error.internal_error');
    expect(described.values['correlationId']).toBe('01a006aa-7e9a-7000');
  });

  it('does not promise a reference it does not have', () => {
    const described = describeAuthError({ code: 'SOMETHING_NOBODY_MAPPED', status: 400 });

    expect(described.key).toBe('error.unexpected');
  });

  it('never answers with the flat refusal that started all this', () => {
    for (const status of [400, 401, 403, 500]) {
      expect(describeAuthError({ status }).key).not.toBe('error.not_allowed');
    }
  });
});
