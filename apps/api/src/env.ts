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
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: httpUrl('http://localhost:8787'),
  APP_ORIGIN: httpUrl('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
});

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
    const detail = source[name] === undefined ? 'is missing' : issue.message;

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
