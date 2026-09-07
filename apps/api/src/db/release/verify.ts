import { drizzle } from 'drizzle-orm/neon-serverless';

import { verifyRuntimeDatabase } from '../compatibility.js';
import { authSchema, schema } from '../schema/index.js';
import { withPool } from '../tooling.js';

import {
  assertConnectedDatabase,
  assertUrlTargetsDatabase,
  databaseFromUrl,
  verifyMigrationJournal,
} from './journal-verification.js';

export interface ReleaseVerification {
  readonly migration: string;
  readonly database: string;
  readonly applicationRole: string;
  readonly authenticationRole: string;
}

/** Verifies both connections that deployed request code receives. */
export async function verifyRuntimeConnections(
  applicationUrl: string,
  authenticationUrl: string,
  expectedDatabase = databaseFromUrl(applicationUrl),
): Promise<{ applicationRole: string; authenticationRole: string }> {
  assertUrlTargetsDatabase('application', applicationUrl, expectedDatabase);
  assertUrlTargetsDatabase('authentication', authenticationUrl, expectedDatabase);
  const application = await withPool(applicationUrl, async (pool) => {
    await assertConnectedDatabase('application', pool, expectedDatabase);

    return verifyRuntimeDatabase(drizzle(pool, { schema }), 'neuron_app');
  });
  const authentication = await withPool(authenticationUrl, async (pool) => {
    await assertConnectedDatabase('authentication', pool, expectedDatabase);

    return verifyRuntimeDatabase(drizzle(pool, { schema: authSchema }), 'neuron_auth');
  });

  return {
    applicationRole: application.role,
    authenticationRole: authentication.role,
  };
}

/** The complete release contract, with the owner used only for the journal. */
export async function verifyRelease(
  ownerUrl: string,
  applicationUrl: string,
  authenticationUrl: string,
  expectedDatabase = databaseFromUrl(ownerUrl),
): Promise<ReleaseVerification> {
  assertUrlTargetsDatabase('owner', ownerUrl, expectedDatabase);
  assertUrlTargetsDatabase('application', applicationUrl, expectedDatabase);
  assertUrlTargetsDatabase('authentication', authenticationUrl, expectedDatabase);
  const migration = await verifyMigrationJournal(ownerUrl, expectedDatabase);
  const runtime = await verifyRuntimeConnections(
    applicationUrl,
    authenticationUrl,
    expectedDatabase,
  );

  return { migration, database: expectedDatabase, ...runtime };
}
