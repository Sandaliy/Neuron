import { describeSkipReason, prepareSchema, resetDatabase, testDatabase } from './database.js';

/**
 * Runs once before the whole test run.
 *
 * The database is brought up to the current schema and emptied here rather than
 * in each file, so that files running side by side cannot truncate a table
 * another one is halfway through using. Every test makes its own users with its
 * own ids, and the isolation policies keep them from seeing each other, so no
 * further clearing is needed.
 */
export default async function setup(): Promise<void> {
  const database = testDatabase();

  if (!database) {
    console.warn(`\n${describeSkipReason()}\n`);

    return;
  }

  await prepareSchema(database);
  await resetDatabase(database);
}
