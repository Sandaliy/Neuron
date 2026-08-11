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
   * The Google OAuth credentials, both or neither.
   *
   * Sign in with Google is offered only when they are here, so the api starts
   * and works without them. That is not a convenience: it is what lets the
   * server run before anyone has spent twenty minutes in the Google console,
   * and what stops a half configured provider from failing at the moment a
   * person clicks the button.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

/**
 * Google needs both halves or neither.
 *
 * One without the other is the shape of a half finished setup, and it would
 * show a sign in button that cannot work. Refusing at startup names the missing
 * half; accepting it would surface as an error message on Google's own domain.
 */
const withProviderPairing = environmentSchema.superRefine((value, context) => {
  if (Boolean(value.GOOGLE_CLIENT_ID) === Boolean(value.GOOGLE_CLIENT_SECRET)) {
    return;
  }

  context.addIssue({
    code: 'custom',
    path: [value.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
    message: 'is needed too, because the other half of the Google credentials is set',
  });
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
  GOOGLE_CLIENT_ID: 'is missing. It comes from the Google Cloud console, under Credentials',
  GOOGLE_CLIENT_SECRET: 'is missing. It comes from the Google Cloud console, under Credentials',
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
  const result = withProviderPairing.safeParse(source);

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
