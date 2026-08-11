import { randomBytes } from 'node:crypto';
import process from 'node:process';

import { describeConnection, requireUrl, withPool, writeEnvVariable } from '../tooling.js';

/**
 * Gives the application role a password and writes its connection string into
 * .env.
 *
 * Kept out of the migration on purpose. Migrations are committed, and a
 * password in a committed file is a password that has leaked. So the migration
 * creates a role that cannot authenticate, and this script, run once, makes it
 * able to.
 *
 * Safe to run again. Doing so rotates the password, which is what you want
 * after the old one has been somewhere it should not have been.
 */

const ROLE = 'neuron_app';

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
 * Builds the application connection string from the owner's.
 *
 * Same host, same database, same query parameters. Only the credential changes.
 *
 * @param ownerUrl the owner connection string
 * @param password the password just set
 * @returns the connection string for the application role
 */
function applicationUrl(ownerUrl: string, password: string): string {
  const url = new URL(ownerUrl);

  url.username = ROLE;
  url.password = password;

  return url.toString();
}

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'It is the connection string Neon shows under Connect, for the neondb_owner role.',
  );

  const password = generatePassword();

  if (!/^[A-Za-z0-9]+$/.test(password)) {
    throw new Error('generated password is not alphanumeric, refusing to build a statement with it');
  }

  await withPool(ownerUrl, async (pool) => {
    const exists = await pool.query('select 1 from pg_roles where rolname = $1', [ROLE]);

    if (exists.rowCount === 0) {
      throw new Error(
        `The role ${ROLE} does not exist. Run pnpm db:migrate first, which creates it.`,
      );
    }

    // ALTER ROLE takes no parameters, so the password is interpolated. The
    // alphabet check above is what makes that safe: this value was generated
    // here and cannot contain a quote.
    await pool.query(`alter role ${ROLE} with login password '${password}'`);
  });

  const appUrl = applicationUrl(ownerUrl, password);

  // Prove it works before writing it down, so a broken value never lands in
  // .env where it would look like a configuration problem tomorrow.
  const identity = await withPool(appUrl, async (pool) => {
    const result = await pool.query<{ current_user: string; bypass: boolean }>(
      'select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass',
    );

    return result.rows[0];
  });

  if (identity?.current_user !== ROLE) {
    throw new Error(`connected as ${identity?.current_user ?? 'nobody'}, expected ${ROLE}`);
  }

  if (identity.bypass) {
    throw new Error(`${ROLE} has BYPASSRLS, which would make every isolation policy pointless`);
  }

  writeEnvVariable('DATABASE_URL', appUrl);

  console.log(`${ROLE} can now sign in, and does not bypass row level security.`);
  console.log(`DATABASE_URL in .env now points at ${describeConnection(appUrl)}`);
  console.log('DATABASE_URL_OWNER is unchanged and stays out of the deployed api.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
