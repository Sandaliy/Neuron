import { access } from 'node:fs/promises';

import { testDatabase } from '../../../api/src/db/testing/database.js';
import setupDatabase from '../../../api/src/db/testing/global-setup.js';

export default async function setup() {
  const database = testDatabase();
  if (process.env['SYNC_CHAOS_DISPOSABLE_DB'] !== 'true' || !database)
    throw new Error(
      'Set SYNC_CHAOS_DISPOSABLE_DB=true and configure the disposable test database.',
    );
  if (process.env['SYNC_CHAOS_REAUTH_REPRO'] === 'true' && !database.authUrl)
    throw new Error('The reauthentication reproduction needs DATABASE_URL_AUTH.');
  await Promise.all([access('dist/index.html'), access('dist/sw.js')]);
  await setupDatabase();
}
