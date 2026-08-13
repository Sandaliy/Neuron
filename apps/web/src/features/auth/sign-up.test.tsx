import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '../../testing/render';

import { SignUpScreen } from './sign-up';

/**
 * The gap these close: there was one password field and no way back into an
 * account whose password was typed wrong. There is no mail sender in this
 * project, so a typo made twice is not a recoverable mistake.
 */

/** The router mounts the route a tick after render, so the form is awaited. */
async function form() {
  const email = await screen.findByLabelText('Email');

  return {
    email,
    password: screen.getByLabelText('Password'),
    confirmation: screen.getByLabelText('Type the password again'),
    submit: screen.getByRole('button', { name: 'Create account' }),
  };
}

describe('creating an account', () => {
  it('asks for the password twice', async () => {
    renderScreen(<SignUpScreen />);

    expect((await form()).confirmation).toBeInTheDocument();
  });

  it('says the two do not match while they are being typed, not on submit', async () => {
    const person = userEvent.setup();

    renderScreen(<SignUpScreen />);

    const fields = await form();

    await person.type(fields.password, 'the slow green kettle');
    await person.type(fields.confirmation, 'the slow green kettl');

    expect(await screen.findByText('The two passwords are different.')).toBeInTheDocument();
  });

  it('says so when they match', async () => {
    const person = userEvent.setup();

    renderScreen(<SignUpScreen />);

    const fields = await form();

    await person.type(fields.password, 'the slow green kettle');
    await person.type(fields.confirmation, 'the slow green kettle');

    expect(await screen.findByText('Both fields match.')).toBeInTheDocument();
  });

  it('will not submit until they match', async () => {
    const person = userEvent.setup();

    renderScreen(<SignUpScreen />);

    const fields = await form();

    await person.type(fields.email, 'someone@example.com');
    await person.type(fields.password, 'the slow green kettle');

    expect(fields.submit).toBeDisabled();

    await person.type(fields.confirmation, 'the slow green kettle');

    await waitFor(() => expect(fields.submit).toBeEnabled());
  });

  it('offers a show and hide toggle on both fields', async () => {
    renderScreen(<SignUpScreen />);

    await form();

    expect(screen.getAllByRole('button', { name: 'Show the password' })).toHaveLength(2);
  });

  it('says what would make the password stronger rather than demanding a symbol', async () => {
    const person = userEvent.setup();

    renderScreen(<SignUpScreen />);

    const fields = await form();

    await person.type(fields.password, 'ten charact');

    expect(
      await screen.findByText(
        'Long enough. Another few characters, or one more word, is the easiest way to make it stronger.',
      ),
    ).toBeInTheDocument();

    await person.clear(fields.password);
    await person.type(fields.password, 'a much longer passphrase here');

    expect(
      await screen.findByText('Long enough that length is no longer the weak part.'),
    ).toBeInTheDocument();
  });
});
