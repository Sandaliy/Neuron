import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { browserGateFailures } from './browser-gate.mjs';

function successfulNeeds(visual = 'true') {
  return {
    'browser-selection': { result: 'success', outputs: { full: 'true', visual, files: '' } },
    'phone-interaction': { result: 'success' },
    'desktop-interaction': { result: 'success' },
    visual: { result: visual === 'true' ? 'success' : 'skipped' },
  };
}

test('full and targeted coverage pass only with all selected suites successful', () => {
  assert.deepEqual(browserGateFailures(successfulNeeds()), []);
  const needs = successfulNeeds('false');
  needs['browser-selection'].outputs.full = 'false';
  needs['browser-selection'].outputs.files = 'tests/smoke.spec.ts';
  assert.deepEqual(browserGateFailures(needs), []);
});

for (const job of ['browser-selection', 'phone-interaction', 'desktop-interaction', 'visual']) {
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    test(`${job} ${result ?? 'missing'} fails selected coverage`, () => {
      const needs = successfulNeeds();
      needs[job].result = result;
      assert.notDeepEqual(browserGateFailures(needs), []);
    });
  }
}

test('missing selection outputs or empty targeted files fail closed', () => {
  for (const key of ['full', 'visual']) {
    const needs = successfulNeeds();
    delete needs['browser-selection'].outputs[key];
    assert.notDeepEqual(browserGateFailures(needs), []);
  }
  const needs = successfulNeeds();
  needs['browser-selection'].outputs.full = 'false';
  assert.notDeepEqual(browserGateFailures(needs), []);
  assert.notDeepEqual(browserGateFailures({}), []);
});

test('the executable gate returns a failing exit code for a failed interaction suite', () => {
  const needs = successfulNeeds();
  needs['phone-interaction'].result = 'failure';
  const result = spawnSync(process.execPath, ['scripts/browser-gate.mjs'], {
    env: { ...process.env, BROWSER_NEEDS: JSON.stringify(needs) },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /phone-interaction: failure/);
});
