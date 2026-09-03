import { describe, expect, it } from 'vitest';

import { EnvironmentError, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://neuron_app:secret@host.neon.tech/neondb?sslmode=require',
  DATABASE_URL_AUTH: 'postgresql://neuron_auth:secret@host.neon.tech/neondb?sslmode=require',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    const env = parseEnv(valid);

    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.APP_ORIGIN.canonical).toBe(valid.APP_ORIGIN);
  });

  it('defaults the mode to development and the port to 8787', () => {
    const env = parseEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8787);
  });

  it('reads the port as a number when the shell gives it as text', () => {
    const env = parseEnv({ ...valid, PORT: '3000' });

    expect(env.PORT).toBe(3000);
  });

  it('names the variable that is missing', () => {
    const { DATABASE_URL: _removed, ...withoutDatabase } = valid;

    expect(() => parseEnv(withoutDatabase)).toThrow(EnvironmentError);
    expect(() => parseEnv(withoutDatabase)).toThrow(/DATABASE_URL is missing/);
  });

  it('lists every problem at once, not just the first', () => {
    let message = '';

    try {
      parseEnv({});
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('APP_ORIGIN');
  });

  it('rejects a connection string that is not postgres', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://host/db' })).toThrow(EnvironmentError);
  });

  it('rejects a secret that is too short to be worth having', () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('rejects an origin that is not a url', () => {
    expect(() => parseEnv({ ...valid, APP_ORIGIN: 'localhost:5173' })).toThrow(EnvironmentError);
  });

  it('takes the first entry as the canonical address and trusts them all', () => {
    const env = parseEnv({
      ...valid,
      APP_ORIGIN: 'https://neuron.example, https://neuron-web-git-*-team.vercel.app',
    });

    expect(env.APP_ORIGIN.canonical).toBe('https://neuron.example');
    expect(env.APP_ORIGIN.trusted).toEqual([
      'https://neuron.example',
      'https://neuron-web-git-*-team.vercel.app',
    ]);
  });

  it('drops a trailing slash, which an Origin header never carries', () => {
    const env = parseEnv({ ...valid, APP_ORIGIN: 'https://neuron.example/' });

    expect(env.APP_ORIGIN.canonical).toBe('https://neuron.example');
  });

  it('refuses a canonical address with a wildcard in it', () => {
    expect(() => parseEnv({ ...valid, APP_ORIGIN: 'https://*.example' })).toThrow(
      /canonical address/,
    );
  });

  it('refuses the address of a page rather than of the app', () => {
    expect(() => parseEnv({ ...valid, APP_ORIGIN: 'https://neuron.example/sign-in' })).toThrow(
      EnvironmentError,
    );
  });

  it('names the entry that is wrong, not just the variable', () => {
    expect(() => parseEnv({ ...valid, APP_ORIGIN: 'https://neuron.example,nonsense' })).toThrow(
      /"nonsense"/,
    );
  });

  it('says where the authentication connection comes from when it is missing', () => {
    const { DATABASE_URL_AUTH: _removed, ...withoutAuth } = valid;

    expect(() => parseEnv(withoutAuth)).toThrow(/DATABASE_URL_AUTH is missing. Run pnpm db:role/);
  });

  it('leaves registration open and email verification off by default', () => {
    const env = parseEnv(valid);

    expect(env.AUTH_REGISTRATION_OPEN).toBe(true);
    expect(env.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(env.AUTH_MAX_REGISTRATIONS_PER_DAY).toBe(3);
  });

  it('reads a switch that arrived as the word false', () => {
    // The one that matters. Every environment variable is a string, and
    // Boolean('false') is true, which is how a flag ends up doing the opposite
    // of what the dashboard says it does.
    expect(parseEnv({ ...valid, AUTH_REGISTRATION_OPEN: 'false' }).AUTH_REGISTRATION_OPEN).toBe(
      false,
    );
    expect(parseEnv({ ...valid, AUTH_REGISTRATION_OPEN: '0' }).AUTH_REGISTRATION_OPEN).toBe(false);
    expect(parseEnv({ ...valid, AUTH_REGISTRATION_OPEN: 'no' }).AUTH_REGISTRATION_OPEN).toBe(false);
  });

  it('reads a switch that arrived as the word true', () => {
    expect(
      parseEnv({ ...valid, AUTH_REQUIRE_EMAIL_VERIFICATION: 'true' })
        .AUTH_REQUIRE_EMAIL_VERIFICATION,
    ).toBe(true);
  });

  it('refuses a switch it cannot read, rather than guessing', () => {
    // A typo has to stop the server. Guessing means the flag silently means
    // one of the two things and nobody finds out which until it matters.
    expect(() => parseEnv({ ...valid, AUTH_REGISTRATION_OPEN: 'off' })).toThrow(EnvironmentError);
  });

  it('reads the registration cap as a number when the shell gives it as text', () => {
    expect(
      parseEnv({ ...valid, AUTH_MAX_REGISTRATIONS_PER_DAY: '10' }).AUTH_MAX_REGISTRATIONS_PER_DAY,
    ).toBe(10);
  });

  it('knows nothing about Google any more', () => {
    // Removed in phase 4.5. Setting the old variables changes nothing, rather
    // than half configuring a provider that is no longer there.
    const env = parseEnv({ ...valid, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });

    expect(env).not.toHaveProperty('GOOGLE_CLIENT_ID');
    expect(env).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
  });
});
