import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { en, formatRecoveryCode, ru } from '@neuron/shared';

import { renderWithProviders } from '../../testing/render';

import { RecoveryCodes, heldCodes, holdCodes, releaseCodes } from './recovery-codes';

/**
 * The screen showing the only copy of the only way back into an account.
 *
 * Everything here is about one thing: it must not be possible to leave this
 * screen by accident. There is no mail sender, so a lost set of codes plus a
 * forgotten password is an account nobody can recover.
 */
/** Bare codes, as the api issues them. The screen adds the grouping. */
const CODES = [
  'ABCDEFGHJKLMNPQ',
  'RSTUVWXYZ234567',
  '89ABCDEFGHJKLMN',
  'PQRSTUVWXYZ2345',
  '6789ABCDEFGHJKL',
  'MNPQRSTUVWXYZ23',
  '456789ABCDEFGHJ',
  'KLMNPQRSTUVWXYZ',
  '3456789ABCDEFGH',
  'JKLMNPQRSTUVWXY',
];

afterEach(() => {
  releaseCodes();
  vi.restoreAllMocks();
});

describe('the recovery codes screen', () => {
  it('will not continue until somebody says they saved them', async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();

    renderWithProviders(
      <RecoveryCodes
        codes={CODES}
        title={en['auth.recoveryCodes.title']}
        warningKey="auth.recoveryCodes.warning"
        onConfirmed={onConfirmed}
      />,
    );

    const button = screen.getByRole('button', { name: en['common.continue'] });

    expect(button).toBeDisabled();

    await user.click(button);
    expect(onConfirmed).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText(en['auth.recoveryCodes.confirm']));

    expect(button).toBeEnabled();

    await user.click(button);
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it('shows every code it was given', () => {
    renderWithProviders(
      <RecoveryCodes
        codes={CODES}
        title={en['auth.recoveryCodes.title']}
        warningKey="auth.recoveryCodes.warning"
        onConfirmed={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(CODES.length);
  });

  it('says plainly what holding one of these means', () => {
    renderWithProviders(
      <RecoveryCodes
        codes={CODES}
        title={en['auth.recoveryCodes.title']}
        warningKey="auth.recoveryCodes.warning"
        onConfirmed={vi.fn()}
      />,
    );

    expect(screen.getByText(en['auth.recoveryCodes.warning'])).toBeTruthy();
  });

  it('says it in Russian when the interface is in Russian', () => {
    renderWithProviders(
      <RecoveryCodes
        codes={CODES}
        title={ru['auth.recoveryCodes.title']}
        warningKey="auth.recoveryCodes.warning"
        onConfirmed={vi.fn()}
      />,
      { locale: 'ru' },
    );

    expect(screen.getByText(ru['auth.recoveryCodes.warning'])).toBeTruthy();
  });

  it('copies every code, not the one somebody could see', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderWithProviders(
      <RecoveryCodes
        codes={CODES}
        title={en['auth.recoveryCodes.title']}
        warningKey="auth.recoveryCodes.warning"
        onConfirmed={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: en['auth.recoveryCodes.copy'] }));

    expect(writeText).toHaveBeenCalledOnce();

    for (const code of CODES) {
      expect(writeText.mock.calls[0]?.[0]).toContain(formatRecoveryCode(code));
    }
  });
});

describe('surviving a reload', () => {
  it('gives the codes back to the page that comes after a refresh', () => {
    // The browser always keeps a reload, so the only defence is that the codes
    // are still there afterwards.
    holdCodes(CODES);

    expect(heldCodes()).toEqual(CODES);
  });

  it('forgets them once they have been confirmed', () => {
    holdCodes(CODES);
    releaseCodes();

    expect(heldCodes()).toBeUndefined();
  });

  it('ignores anything in storage that is not a set of codes', () => {
    sessionStorage.setItem('neuron.account-codes.pending', '{"not":"an array"}');

    expect(heldCodes()).toBeUndefined();
  });
});
