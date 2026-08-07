import { describe, expect, it } from 'vitest';

import { EnvironmentError, parseEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://user:secret@host.neon.tech/neondb?sslmode=require',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:8787',
  APP_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    const env = parseEnv(valid);

    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.APP_ORIGIN).toBe(valid.APP_ORIGIN);
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
    expect(message).toContain('BETTER_AUTH_URL');
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
});
