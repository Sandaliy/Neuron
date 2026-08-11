import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Pool } from '@neondatabase/serverless';

/**
 * Shared plumbing for the scripts that run from a terminal: the role setup, the
 * seed and the benchmark.
 *
 * None of this is reachable from the server. These scripts hold the owner
 * credential, which the deployed api never receives.
 */

const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

let loaded = false;

/** Reads the .env file at the top of the project, once. */
export function loadDotEnv(): void {
  if (loaded) {
    return;
  }

  try {
    process.loadEnvFile(envPath);
  } catch {
    // Absent, so the values have to come from the shell.
  }

  loaded = true;
}

/**
 * Reads a connection string, failing with an explanation rather than a stack
 * trace three calls later.
 *
 * @param name the variable to read
 * @param why what it is for, shown when it is missing
 * @returns the connection string
 */
export function requireUrl(name: string, why: string): string {
  loadDotEnv();

  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set in .env. ${why}`);
  }

  if (!value.startsWith('postgres://') && !value.startsWith('postgresql://')) {
    throw new Error(`${name} does not look like a Postgres connection string.`);
  }

  return value;
}

/**
 * Opens a pool, runs something, and closes the pool whatever happens.
 *
 * @param connectionString where to connect
 * @param work what to do with the pool
 * @returns whatever the work returned
 */
export async function withPool<T>(
  connectionString: string,
  work: (pool: Pool) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString });

  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Describes a connection without giving away the credential in it.
 *
 * @param connectionString the url
 * @returns the role and host, safe to print
 */
export function describeConnection(connectionString: string): string {
  const url = new URL(connectionString);

  return `${url.username}@${url.hostname}${url.pathname}`;
}

/**
 * Rewrites one variable in the .env file, leaving the rest of it alone.
 *
 * Appends the line when the variable is not there yet, so the file keeps its
 * comments and its order instead of being regenerated.
 *
 * @param name the variable
 * @param value the new value
 */
export function writeEnvVariable(name: string, value: string): void {
  let text: string;

  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    // No file yet, which is the case on a fresh clone.
    text = '';
  }

  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');

  const next = pattern.test(text)
    ? text.replace(pattern, line)
    : `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${line}\n`;

  writeFileSync(envPath, next);
}

/** Where the .env file being read and written actually is. */
export const ENV_PATH = envPath;
