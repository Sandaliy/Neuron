import process from 'node:process';

import { describeConnection, requireUrl } from '../tooling.js';

import { verifyRelease } from './verify.js';

async function main(): Promise<void> {
  const ownerUrl = requireUrl(
    'DATABASE_URL_OWNER',
    'Release verification reads the Drizzle journal through the migration-only owner.',
  );
  const applicationUrl = requireUrl(
    'DATABASE_URL',
    'It is the restricted neuron_app connection used by collection requests.',
  );
  const authenticationUrl = requireUrl(
    'DATABASE_URL_AUTH',
    'It is the restricted neuron_auth connection used only by Better Auth.',
  );
  const result = await verifyRelease(ownerUrl, applicationUrl, authenticationUrl);

  console.log(`required migration ${result.migration} is applied`);
  console.log(
    `runtime application: ${describeConnection(applicationUrl)} (${result.applicationRole})`,
  );
  console.log(
    `runtime authentication: ${describeConnection(authenticationUrl)} (${result.authenticationRole})`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
