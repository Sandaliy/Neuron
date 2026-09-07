import process from 'node:process';

import { requireUrl } from '../tooling.js';

import { verifyMigrationJournal } from './verify.js';

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'Journal verification is migration tooling and runs through the database owner.',
  );
  const migration = await verifyMigrationJournal(ownerUrl);

  console.log(`required migration ${migration} is applied`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
