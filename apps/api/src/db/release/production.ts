import process from 'node:process';

import { applyMigrations } from '../migrate/main.js';
import { requireUrl } from '../tooling.js';

import { inspectMigrationJournal, verifyMigrationJournal } from './journal-verification.js';

export interface ProductionMigrationActions {
  readonly inspect: () => Promise<{
    readonly migration: string;
    readonly state: 'current' | 'behind';
  }>;
  readonly migrate: () => Promise<void>;
  readonly verify: () => Promise<string>;
}

/**
 * Applies only a journal-confirmed pending migration. Inspection failures are
 * deliberately fatal: they must never be treated as permission to migrate.
 */
export async function ensureProductionMigrations(
  actions: ProductionMigrationActions,
): Promise<{ readonly migration: string; readonly migrated: boolean }> {
  const journal = await actions.inspect();

  if (journal.state === 'behind') {
    await actions.migrate();
  }

  const migration = await actions.verify();

  return { migration, migrated: journal.state === 'behind' };
}

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'Production migration tooling runs through the protected database owner.',
  );
  const result = await ensureProductionMigrations({
    inspect: () => inspectMigrationJournal(ownerUrl),
    migrate: () => applyMigrations(ownerUrl),
    verify: () => verifyMigrationJournal(ownerUrl),
  });

  console.log(
    result.migrated
      ? `applied and verified required migration ${result.migration}`
      : `required migration ${result.migration} is already applied`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
