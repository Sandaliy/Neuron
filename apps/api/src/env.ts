import process from 'node:process';

import { z } from 'zod';

/**
 * The only place in the api that touches process.env. Everything else takes the
 * parsed result, so a missing variable is caught once, at startup, with a
 * message that names it.
 */

/**
 * z.url() alone is not enough: the url parser reads "localhost:5173" as a url
 * with the scheme "localhost", so a missing http:// would slip through and
 * break CORS at runtime instead of at startup.
 */
const httpUrl = (example: string) =>
  z
    .url(`must be a full url, for example ${example}`)
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      `must start with http:// or https://, for example ${example}`,
    );

/**
 * A switch, as it survives a trip through an environment variable.
 *
 * Everything in `process.env` is a string, and `Boolean('false')` is true,
 * which is the single most common way a feature flag ends up doing the
 * opposite of what the dashboard says. Only the words below are accepted, so a
 * typo stops the server rather than silently meaning one of the two.
 */
const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((value) =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1' || value === 'yes',
  );

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    'must be the connection string from Neon, starting with postgresql://',
  );

const environmentSchema = z.object({
  /**
   * The application connection, using the restricted role.
   *
   * Not the connection string Neon shows first: that one is the database owner,
   * which can drop tables and, because Neon grants it BYPASSRLS, is not subject
   * to the isolation policies at all. The owner url lives in DATABASE_URL_OWNER
   * and is used by the migration tool only.
   */
  DATABASE_URL: postgresUrl,
  /**
   * The authentication connection, using the second restricted role.
   *
   * Better Auth reaches the four tables it owns through this and through
   * nothing else. The application connection above cannot read an email
   * address, a password hash or a session row at all, which is what stops a bug
   * in a route handler from becoming an account takeover.
   *
   * Written by `pnpm db:role` alongside DATABASE_URL. Both have to be set on
   * the server.
   */
  DATABASE_URL_AUTH: postgresUrl,
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: httpUrl('http://localhost:8787'),
  APP_ORIGIN: httpUrl('http://localhost:5173'),
  /**
   * Whether anybody new may register.
   *
   * True while friends are still signing up, false the moment they have. One
   * switch in the Vercel settings, no deploy of a code change, and nobody with
   * an account notices. It exists only until email verification is switched on,
   * which is the real answer to somebody registering three hundred accounts.
   */
  AUTH_REGISTRATION_OPEN: booleanFlag.default(true),
  /**
   * Accounts one address may successfully create in a day.
   *
   * Successes, not attempts. The rate limiter already counts attempts, and an
   * attempt limit does nothing about somebody registering patiently. Also
   * temporary, for the same reason.
   */
  AUTH_MAX_REGISTRATIONS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(3),
  /**
   * Whether an account has to confirm its address before it can be used.
   *
   * False, because there is no mail sender. The whole path behind this flag is
   * written and tested with it on, so switching it costs a domain, a provider
   * and this variable, rather than a phase of work discovered on the day.
   */
  AUTH_REQUIRE_EMAIL_VERIFICATION: booleanFlag.default(false),
  /**
   * Which mailer to build.
   *
   * `log` writes the message to the server log and sends nothing, which is what
   * makes the verification flow testable today. There is no second value yet;
   * adding one is the entire cost of turning mail on.
   */
  MAILER: z.enum(['log']).default('log'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

/**
 * What to do about a variable that is missing, keyed by its name.
 *
 * A message that says a value is absent leaves the reader looking for where it
 * comes from. These say it.
 */
const REMEDIES: Record<string, string> = {
  DATABASE_URL: 'is missing. Run pnpm db:role, which writes it',
  DATABASE_URL_AUTH: 'is missing. Run pnpm db:role, which writes it alongside DATABASE_URL',
  BETTER_AUTH_SECRET:
    'is missing. It signs session cookies and encrypts the two factor secrets, so it has to be at least 32 random characters and has to stay the same',
};

export type Env = z.infer<typeof environmentSchema>;

export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
}

/**
 * Validates a set of environment variables. Pure, so the tests can hand it an
 * object instead of poking at the real process.
 *
 * @throws EnvironmentError listing every variable that is wrong, not just the first
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = environmentSchema.safeParse(source);

  if (result.success) {
    return result.data;
  }

  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? 'unknown');
    const detail = source[name] === undefined ? (REMEDIES[name] ?? 'is missing') : issue.message;

    return `  ${name} ${detail}`;
  });

  throw new EnvironmentError(
    [
      'The api cannot start because its configuration is incomplete:',
      ...problems,
      '',
      'Locally these live in the .env file at the top of the project.',
      'On Vercel they live in the project settings, under Environment Variables.',
    ].join('\n'),
  );
}

let cached: Env | undefined;

/** Parses the real environment once and reuses the result. */
export function loadEnv(): Env {
  cached ??= parseEnv(process.env);

  return cached;
}
