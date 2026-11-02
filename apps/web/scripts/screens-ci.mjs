/**
 * Build once, then run serial interactions against Vite preview. An explicit
 * project narrows a reproduction; without one this remains the full local gate.
 *
 *   pnpm --filter @neuron/web test:screens:ci
 *   pnpm --filter @neuron/web test:screens:ci tests/study.spec.ts --project=phone-interaction
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function interactionArguments(args) {
  const hasProject = args.some((arg) => arg === '--project' || arg.startsWith('--project='));
  return [
    'exec',
    'playwright',
    'test',
    ...(hasProject ? [] : ['--project=phone-interaction', '--project=desktop-interaction']),
    '--workers=1',
    ...args,
  ];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // pnpm supplies its JavaScript entry point even on Windows. Calling it with
  // Node preserves argument boundaries without routing filters through a shell.
  const pnpm = process.env['npm_execpath'];
  if (!pnpm) throw new Error('Run this script with pnpm --filter @neuron/web test:screens:ci');
  const run = (args, env = process.env) => {
    const result = spawnSync(process.execPath, [pnpm, ...args], { stdio: 'inherit', env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  };

  run(['--filter', '@neuron/web...', 'build']);
  run(interactionArguments(process.argv.slice(2)), { ...process.env, CI: 'true' });
}
