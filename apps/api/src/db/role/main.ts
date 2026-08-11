import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { describeConnection, requireUrl, withPool, writeEnvVariable } from '../tooling.js';

import type { Pool } from '@neondatabase/serverless';

/**
 * Gives the two application roles a password each and writes their connection
 * strings into .env.
 *
 * Kept out of the migrations on purpose. Migrations are committed, and a
 * password in a committed file is a password that has leaked. So the migrations
 * create roles that cannot authenticate, and this script, run once, makes them
 * able to.
 *
 * Safe to run again. Doing so rotates both passwords, which is what you want
 * after either has been somewhere it should not have been. Rotating means the
 * deployed server needs the new values too, so run it and then update Vercel.
 */

/**
 * The two roles, and what each connection string is for.
 *
 * `neuron_app` reaches the collection and ten columns of `user`. `neuron_auth`
 * reaches the four Better Auth tables and nothing else. Two roles rather than
 * one is what makes "this statement is part of signing in" something the
 * database can check instead of something the application asserts.
 */
const ROLES = [
  { name: 'neuron_app', variable: 'DATABASE_URL' },
  { name: 'neuron_auth', variable: 'DATABASE_URL_AUTH' },
] as const;

/**
 * A password made only of letters and digits.
 *
 * Restricted alphabet for two reasons: it goes into a connection string, where
 * a slash or an at sign would have to be escaped, and it is interpolated into
 * an ALTER ROLE statement, which cannot take a bound parameter. Sixty
 * characters of this alphabet is around 350 bits, so nothing is lost by
 * dropping the punctuation.
 *
 * @returns the password
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(60);

  let password = '';

  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }

  return password;
}

/**
 * Builds a role's connection string from the owner's.
 *
 * Same host, same database, same query parameters. Only the credential changes.
 *
 * @param ownerUrl the owner connection string
 * @param role the role to connect as
 * @param password the password just set
 * @returns the connection string for that role
 */
function connectionFor(ownerUrl: string, role: string, password: string): string {
  const url = new URL(ownerUrl);

  url.username = role;
  url.password = password;

  return url.toString();
}

/**
 * Sets one role's password and proves the result works.
 *
 * @param pool the owner connection
 * @param ownerUrl the owner connection string, to build the role's from
 * @param role the role name
 * @returns the connection string for the role
 */
async function provision(pool: Pool, ownerUrl: string, role: string): Promise<string> {
  const exists = await pool.query('select 1 from pg_roles where rolname = $1', [role]);

  if (exists.rowCount === 0) {
    throw new Error(
      `The role ${role} does not exist. Run pnpm db:migrate first, which creates it.`,
    );
  }

  const password = generatePassword();

  if (!/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error(
      'generated password is not alphanumeric, refusing to build a statement with it',
    );
  }

  // ALTER ROLE takes no parameters, so the password is interpolated. The
  // alphabet check above is what makes that safe: this value was generated
  // here and cannot contain a quote.
  await pool.query(`alter role ${role} with login password '${password}'`);

  const url = connectionFor(ownerUrl, role, password);

  // Prove it works before writing it down, so a broken value never lands in
  // .env where it would look like a configuration problem tomorrow.
  const identity = await withPool(url, async (rolePool) => {
    const result = await rolePool.query<{ current_user: string; bypass: boolean }>(
      'select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass',
    );

    return result.rows[0];
  });

  if (identity?.current_user !== role) {
    throw new Error(`connected as ${identity?.current_user ?? 'nobody'}, expected ${role}`);
  }

  if (identity.bypass) {
    throw new Error(`${role} has BYPASSRLS, which would make every isolation policy pointless`);
  }

  return url;
}

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'It is the connection string Neon shows under Connect, for the neondb_owner role.',
  );

  const written: { role: string; variable: string; url: string }[] = [];

  await withPool(ownerUrl, async (pool) => {
    for (const role of ROLES) {
      written.push({
        role: role.name,
        variable: role.variable,
        url: await provision(pool, ownerUrl, role.name),
      });
    }
  });

  for (const entry of written) {
    writeEnvVariable(entry.variable, entry.url);
    console.log(`${entry.role} can now sign in, and does not bypass row level security.`);
    console.log(`${entry.variable} in .env now points at ${describeConnection(entry.url)}`);
  }

  console.log('');
  console.log('Both variables have to be set on the server as well.');
  console.log('DATABASE_URL_OWNER is unchanged and stays out of the deployed api.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
