import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { interactionArguments } from './screens-ci.mjs';

const script = fileURLToPath(new URL('./screens-ci.mjs', import.meta.url));

test('the default built-app gate keeps both viewports and one worker', () => {
  assert.deepEqual(interactionArguments([]), [
    'exec',
    'playwright',
    'test',
    '--project=phone-interaction',
    '--project=desktop-interaction',
    '--workers=1',
  ]);
});

for (const project of [['--project=phone-interaction'], ['--project', 'desktop-interaction']]) {
  test(`explicit ${project.join(' ')} replaces default projects`, () => {
    assert.deepEqual(interactionArguments(['tests/study-language.spec.ts', ...project]), [
      'exec',
      'playwright',
      'test',
      '--workers=1',
      'tests/study-language.spec.ts',
      ...project,
    ]);
  });
}

function invoke(t, args, failure = '') {
  const directory = mkdtempSync(path.join(tmpdir(), 'neuron-browser-command-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = path.join(directory, 'pnpm fixture.mjs');
  const log = path.join(directory, 'commands.jsonl');
  writeFileSync(
    entry,
    String.raw`
    import { appendFileSync } from 'node:fs';
    const args = process.argv.slice(2);
    appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ args, ci: process.env.CI }) + '\n');
    if (args.includes(process.env.FAIL_COMMAND)) process.exit(7);
  `,
  );
  const result = spawnSync(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      CI: 'false',
      npm_execpath: entry,
      COMMAND_LOG: log,
      FAIL_COMMAND: failure,
    },
    encoding: 'utf8',
  });
  const commands = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  return { result, commands };
}

test('the executable preserves filters literally, builds first and enables CI for Playwright', (t) => {
  const args = [
    'tests/study-language.spec.ts',
    '--grep',
    'a confirmed language change $value & (motion)',
    '--project=phone-interaction',
  ];
  const { result, commands } = invoke(t, args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(commands, [
    { args: ['--filter', '@neuron/web...', 'build'], ci: 'false' },
    { args: interactionArguments(args), ci: 'true' },
  ]);
});

for (const failure of ['build', 'test']) {
  test(`a failed ${failure} preserves its exit status`, (t) => {
    const { result, commands } = invoke(t, [], failure);
    assert.equal(result.status, 7, result.stderr);
    assert.equal(commands.length, failure === 'build' ? 1 : 2);
  });
}
