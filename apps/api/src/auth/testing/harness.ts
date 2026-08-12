import { randomUUID } from 'node:crypto';

import { createOTP } from '@better-auth/utils/otp';
import { Hono } from 'hono';

import { mountApp } from '../../create-app.js';
import { createAuthDb, createDb } from '../../db/client.js';
import { parseEnv } from '../../env.js';
import { LogMailer } from '../../mailer.js';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '../totp-replay.js';

import type { TestDatabase } from '../../db/testing/database.js';
import type { Env } from '../../env.js';

/**
 * A real server, a real Better Auth, a real database, and a real cookie jar.
 *
 * Nothing is stubbed here, and that is the point. The route tests elsewhere
 * replace the session, because they are about what a handler does with a
 * request and standing Better Auth up in front of every one of them would cost
 * a password hash per assertion. These tests are about signing in itself, so
 * the only honest version keeps the argon2, the cookies, the redirects and the
 * database exactly as they ship.
 */

/**
 * A suffix unique to this run of this file.
 *
 * The test files run side by side against one database, and the database is
 * emptied once before the whole run rather than between files, so that one file
 * cannot truncate a table another is halfway through. That works only if no two
 * tests contend for the same row, and an email address is a unique key. So
 * every address and every caller address is minted here rather than written
 * down in a test, and no two tests can collide however they are interleaved.
 */
const RUN = randomUUID().replaceAll('-', '').slice(0, 10);

let minted = 0;

/** An address nobody else in this run will use. */
export function uniqueEmail(label: string): string {
  minted += 1;

  return `${label}-${RUN}-${minted}@neuron.test`;
}

/**
 * A caller address nobody else in this run will use.
 *
 * The rate limiter and the registration cap both key on this, so two tests
 * sharing one would have each other's attempts counted against them.
 */
export function uniqueAddress(): string {
  minted += 1;

  // Not shaped like an address, and it does not need to be: nothing between
  // here and the hash parses it. An earlier version did shape it like one, and
  // squeezing a run id and a counter into four octets meant two workers could
  // mint the same one, which showed up as a test being rate limited by a test
  // in another file.
  return `${RUN}-${minted}`;
}

/** Where the test server thinks it lives. */
const BASE_URL = 'http://localhost:8787';

/** What a test can change about the environment it runs against. */
export interface HarnessOptions {
  readonly registrationOpen?: boolean;
  readonly requireEmailVerification?: boolean;
  readonly maxRegistrationsPerDay?: number;
  /** Production turns Secure on, which is the only way to check for it. */
  readonly production?: boolean;
}

/**
 * Builds the environment a harness runs with.
 *
 * Through `parseEnv`, not around it, so a test cannot accidentally run against
 * a shape the real server would refuse to start with.
 *
 * @param database the test connections
 * @param options what this test needs to differ
 */
function environmentFor(database: TestDatabase, options: HarnessOptions): Env {
  if (!database.authUrl) {
    throw new Error('DATABASE_URL_AUTH is not set, so there is no authentication role');
  }

  return parseEnv({
    DATABASE_URL: database.appUrl,
    DATABASE_URL_AUTH: database.authUrl,
    // Fixed rather than random. It encrypts the two factor secrets, so a value
    // that changed between two servers in one test would make the second
    // unable to read what the first wrote.
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-to-be-accepted',
    BETTER_AUTH_URL: BASE_URL,
    APP_ORIGIN: BASE_URL,
    AUTH_REGISTRATION_OPEN: String(options.registrationOpen ?? true),
    AUTH_REQUIRE_EMAIL_VERIFICATION: String(options.requireEmailVerification ?? false),
    AUTH_MAX_REGISTRATIONS_PER_DAY: String(options.maxRegistrationsPerDay ?? 3),
    NODE_ENV: options.production === true ? 'production' : 'test',
  });
}

/** One browser, as far as the server can tell. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Takes whatever a response set. */
  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const separator = pair?.indexOf('=') ?? -1;

      if (!pair || separator < 1) {
        continue;
      }

      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);

      // An expiry in the past is how a cookie is deleted. A jar that stored it
      // anyway would keep sending a session the server has just closed, which
      // is exactly the bug these tests exist to catch.
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(header) || /max-age=0/i.test(header)) {
        this.cookies.delete(name);

        continue;
      }

      this.cookies.set(name, value);
    }
  }

  /** What a browser would send back. */
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get size(): number {
    return this.cookies.size;
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  value(name: string): string | undefined {
    return this.cookies.get(name);
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  clear(): void {
    this.cookies.clear();
  }
}

/** What one request came back as. */
export interface Answer<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly response: Response;
}

/**
 * Harnesses already built, keyed by what they were built with.
 *
 * A Harness holds two Neon pools, and a file with forty tests building one each
 * would open eighty connections and close none. Each test file runs in its own
 * worker, so this keeps the whole run to a handful per file. Nothing in a
 * Harness is per test: the flags are the flags, and the mailer is read by
 * address.
 */
const built = new Map<string, Harness>();

/**
 * The server for one set of flags, built once.
 *
 * @param database the test connections
 * @param options what this test needs to differ
 */
export function harnessFor(database: TestDatabase, options: HarnessOptions = {}): Harness {
  const key = JSON.stringify([
    options.registrationOpen ?? true,
    options.requireEmailVerification ?? false,
    options.maxRegistrationsPerDay ?? 3,
    options.production ?? false,
  ]);

  let harness = built.get(key);

  if (!harness) {
    harness = new Harness(database, options);
    built.set(key, harness);
  }

  return harness;
}

export class Harness {
  readonly app: Hono;
  readonly mailer: LogMailer;
  readonly env: Env;

  constructor(database: TestDatabase, options: HarnessOptions = {}) {
    this.env = environmentFor(database, options);
    this.mailer = new LogMailer();
    this.app = mountApp(new Hono(), {
      env: this.env,
      db: createDb(this.env.DATABASE_URL),
      authDb: createAuthDb(this.env.DATABASE_URL_AUTH),
      mailer: this.mailer,
    });
  }

  /**
   * Makes one request, the way a browser would.
   *
   * @param method the http method
   * @param path where, relative to the root
   * @param options the body, the jar, and the address to appear to come from
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: {
      readonly body?: unknown;
      readonly jar?: CookieJar;
      readonly address?: string;
      readonly headers?: Record<string, string>;
    } = {},
  ): Promise<Answer<T>> {
    const headers: Record<string, string> = {
      // A fresh address per request unless the test pins one. The limiter in
      // front of the auth routes allows twenty attempts a minute per address,
      // and it is doing its job: a suite that let every test share one address
      // would spend most of its run being correctly refused. The tests that
      // are about the limiter pin an address on purpose.
      'x-forwarded-for': options.address ?? uniqueAddress(),
      origin: BASE_URL,
      ...options.headers,
    };

    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const cookie = options.jar?.header();

    if (cookie) {
      headers['cookie'] = cookie;
    }

    const response = await this.app.request(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    options.jar?.absorb(response);

    const text = await response.text();

    let body: unknown = text;

    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON. Left as text, which is what a test asserting on a redirect
      // or an empty body wants to see.
    }

    return { status: response.status, body: body as T, response };
  }

  post<T = unknown>(
    path: string,
    body: unknown,
    options: { readonly jar?: CookieJar; readonly address?: string } = {},
  ): Promise<Answer<T>> {
    return this.request<T>('POST', path, { ...options, body });
  }

  get<T = unknown>(
    path: string,
    options: { readonly jar?: CookieJar; readonly address?: string } = {},
  ): Promise<Answer<T>> {
    return this.request<T>('GET', path, options);
  }
}

/** What registration hands back, once the plugin has added to it. */
export interface RegistrationAnswer {
  readonly user: { readonly id: string; readonly email: string };
  readonly recoveryCodes: string[];
  readonly warningKey: string;
}

/** One registered person, and everything a test needs to talk about them. */
export interface Registered {
  readonly email: string;
  readonly userId: string;
  readonly jar: CookieJar;
  readonly recoveryCodes: string[];
  readonly address: string;
}

/** A password that passes the policy, used wherever the password is not the point. */
export const GOOD_PASSWORD = 'chimney-oxide-lantern';

/**
 * Registers somebody and returns what came back, with their cookies.
 *
 * @param harness the server
 * @param email the address
 * @param options the password, and where the request appears to come from
 */
export async function register(
  harness: Harness,
  email: string,
  options: { readonly password?: string; readonly address?: string; readonly jar?: CookieJar } = {},
): Promise<{ answer: Answer<RegistrationAnswer>; jar: CookieJar }> {
  const jar = options.jar ?? new CookieJar();
  const answer = await harness.post<RegistrationAnswer>(
    '/api/auth/sign-up/email',
    {
      email,
      password: options.password ?? GOOD_PASSWORD,
      name: email.split('@')[0],
    },
    { jar, ...(options.address === undefined ? {} : { address: options.address }) },
  );

  return { answer, jar };
}

/**
 * Registers somebody nobody else in this run shares, and expects it to work.
 *
 * The shape most tests want: a fresh person, their id for scoping a query
 * against the shared database, their cookies, and their codes.
 *
 * @param harness the server
 * @param label a word that says which test this person belongs to
 * @param options the password, and where the request appears to come from
 */
export async function registerFresh(
  harness: Harness,
  label: string,
  options: { readonly password?: string; readonly address?: string } = {},
): Promise<Registered> {
  const email = uniqueEmail(label);
  const address = options.address ?? uniqueAddress();
  const { answer, jar } = await register(harness, email, { ...options, address });

  if (answer.status !== 200) {
    throw new Error(`registering ${label} failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  }

  return {
    email,
    userId: answer.body.user.id,
    jar,
    recoveryCodes: answer.body.recoveryCodes,
    address,
  };
}

/** Signs somebody in, and returns the jar holding the result. */
export async function signIn(
  harness: Harness,
  email: string,
  password: string = GOOD_PASSWORD,
): Promise<{ answer: Answer<{ user?: { id: string } }>; jar: CookieJar }> {
  const jar = new CookieJar();
  const answer = await harness.post<{ user?: { id: string } }>(
    '/api/auth/sign-in/email',
    { email, password },
    { jar, address: uniqueAddress() },
  );

  return { answer, jar };
}

/**
 * The code an authenticator app would show for a given moment.
 *
 * @param uri the otpauth:// uri enrollment handed back
 * @param step which thirty second step, or the current one
 */
export async function totpCodeFor(uri: string, step?: number): Promise<string> {
  const secret = secretFromUri(uri);
  const otp = createOTP(secret, { digits: TOTP_DIGITS, period: TOTP_PERIOD_SECONDS });

  return step === undefined ? otp.totp() : otp.hotp(step);
}

/** Which thirty second step a moment falls in. */
export function currentStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * Pulls the shared secret back out of the enrollment uri.
 *
 * The uri carries it base32 encoded, which is what the QR code is a picture of.
 * A test reading it is doing exactly what the phone does.
 *
 * @param uri the otpauth:// uri
 * @returns the secret, as the OTP functions want it
 */
function secretFromUri(uri: string): string {
  const encoded = new URL(uri).searchParams.get('secret');

  if (!encoded) {
    throw new Error(`no secret in ${uri}`);
  }

  return decodeBase32(encoded);
}

/** RFC 4648 base32, decoded back to the raw string the secret started as. */
function decodeBase32(encoded: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (const character of encoded.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(character);

    if (index === -1) {
      continue;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((value >>> bits) & 0xff);
    }
  }

  return output;
}
