/**
 * The browser gate as CI runs it: build the web app and its packages, then
 * run the phone and desktop interaction projects against Vite preview on one
 * worker. Extra arguments go to Playwright, so a single file can be checked
 * against the built app too.
 *
 *   pnpm --filter @neuron/web test:screens:ci
 *   pnpm --filter @neuron/web test:screens:ci tests/study.spec.ts
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('pnpm', ['--filter', '"@neuron/web..."', 'build']);
run(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    '--project=phone-interaction',
    '--project=desktop-interaction',
    '--workers=1',
    ...process.argv.slice(2),
  ],
  { ...process.env, CI: 'true' },
);
