import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/**
 * Asks the database what time it thinks it is. Nothing else, no user data.
 * This exists so the /db-check route does not carry raw SQL, and so the
 * connection can be proven before anything real depends on it.
 */
export async function readDatabaseTime(db: Database): Promise<string> {
  const result = await db.execute<{ now: string }>(sql`select now() as now`);
  const row = result.rows[0];

  if (!row) {
    throw new Error('The database answered without a row.');
  }

  return String(row.now);
}
