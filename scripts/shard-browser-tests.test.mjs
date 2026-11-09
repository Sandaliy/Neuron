import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { listedFiles, shardFiles, UNKNOWN_FILE_SECONDS } from './shard-browser-tests.mjs';

const durations = JSON.parse(readFileSync('apps/web/tests/browser-durations.json', 'utf8'));

function all(files, table, total) {
  return Array.from({ length: total }, (_, index) => shardFiles(files, table, index + 1, total));
}

test('every file runs on exactly one runner', () => {
  for (const project of ['phone-interaction', 'desktop-interaction']) {
    const files = Object.keys(durations[project]).map((name) => `tests/${name}`);
    const shards = all(files, durations[project], 5);
    const assigned = shards.flatMap((shard) => shard.files).sort();
    assert.deepEqual(assigned, [...files].sort());
  }
});

test('measured files are balanced, not split by position', () => {
  for (const project of ['phone-interaction', 'desktop-interaction']) {
    const files = Object.keys(durations[project]).map((name) => `tests/${name}`);
    const loads = all(files, durations[project], 5).map((shard) => shard.seconds);
    const longest = Math.max(...Object.values(durations[project]));
    // Greedy assignment never leaves a gap larger than the longest single file.
    assert.ok(Math.max(...loads) - Math.min(...loads) <= longest, `${project}: ${loads}`);
  }
});

test('every runner computes the same split regardless of input order', () => {
  const files = ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/c.spec.ts', 'tests/d.spec.ts'];
  const table = { 'a.spec.ts': 10, 'b.spec.ts': 10, 'c.spec.ts': 30 };
  assert.deepEqual(all(files, table, 2), all([...files].reverse(), table, 2));
});

test('unmeasured files still run, with an assumed duration', () => {
  const shard = shardFiles(['tests/new.spec.ts'], {}, 1, 3);
  assert.deepEqual(shard, { files: ['tests/new.spec.ts'], seconds: UNKNOWN_FILE_SECONDS });
  assert.deepEqual(shardFiles(['tests/new.spec.ts'], {}, 2, 3).files, []);
});

test('invalid shard positions are refused', () => {
  assert.throws(() => shardFiles([], {}, 0, 5));
  assert.throws(() => shardFiles([], {}, 6, 5));
  assert.throws(() => shardFiles([], {}, 1, 0));
});

test('the listing yields test files only once, with tests/ paths', () => {
  const report = {
    suites: [
      { file: 'import.spec.ts', specs: [{}], suites: [{ file: 'import.spec.ts', specs: [{}] }] },
      { file: 'empty.spec.ts', specs: [], suites: [] },
      { file: 'nested\\study.spec.ts', specs: [{}] },
    ],
  };
  assert.deepEqual(listedFiles(report), ['tests/import.spec.ts', 'tests/study.spec.ts']);
});
