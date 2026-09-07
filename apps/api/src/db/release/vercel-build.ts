import process from 'node:process';

import { describeConnection, requireUrl } from '../tooling.js';

import { shouldVerifyLiveSchema, waitForProductionSchema } from './vercel-build-policy.js';
import { verifyRuntimeConnections } from './verify.js';

async function main(): Promise<void> {
  if (!shouldVerifyLiveSchema(process.env['VERCEL_ENV'])) {
    console.log('live schema verification is reserved for production builds');

    return;
  }

  const applicationUrl = requireUrl(
    'DATABASE_URL',
    'Vercel must build against the restricted application connection for its target environment.',
  );
  const authenticationUrl = requireUrl(
    'DATABASE_URL_AUTH',
    'Vercel must build against the restricted authentication connection for its target environment.',
  );
  let waiting = false;
  const result = await waitForProductionSchema(
    () => verifyRuntimeConnections(applicationUrl, authenticationUrl),
    {
      onWait() {
        if (!waiting) {
          console.warn('waiting for the trusted production migration workflow');
          waiting = true;
        }
      },
    },
  );

  console.log(
    `schema compatible for ${describeConnection(applicationUrl)} (${result.applicationRole}) and ${result.authenticationRole}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
