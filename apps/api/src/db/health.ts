import { sql } from 'drizzle-orm';

import { requireCompatibleApplicationSchema } from './compatibility.js';

import type { Database } from './client.js';

/**
 * Verifies compatibility, then asks the database what time it thinks it is.
 * Nothing here reads user data. This exists so the /db-check route does not
 * carry raw SQL and cannot report a merely reachable but incompatible schema.
 */
export async function readDatabaseTime(db: Database): Promise<string> {
  await requireCompatibleApplicationSchema(db);

  const result = await db.execute<{ now: string }>(sql`select now() as now`);
  const row = result.rows[0];

  if (!row) {
    throw new Error('The database answered without a row.');
  }

  return String(row.now);
}
