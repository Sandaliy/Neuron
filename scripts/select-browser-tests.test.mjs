import assert from 'node:assert/strict';
import test from 'node:test';

import { selectBrowserTests } from './select-browser-tests.mjs';

test('ordinary docs changes keep only the smoke path', () => {
  assert.deepEqual(selectBrowserTests(['docs/STATE.md']), {
    full: false,
    visual: false,
    files: ['tests/smoke.spec.ts'],
  });
});

test('screen changes include their existing regressions', () => {
  const result = selectBrowserTests(['apps/web/src/features/import/import-screen.tsx']);
  assert.equal(result.full, false);
  assert.deepEqual(result.files, ['tests/import.spec.ts', 'tests/smoke.spec.ts']);
});

test('shared browser changes require full interactions', () => {
  const result = selectBrowserTests(['apps/web/src/lib/notes.ts']);
  assert.equal(result.full, true);
  assert.equal(result.visual, false);
});

test('global visual changes also require Windows snapshots', () => {
  const result = selectBrowserTests(['apps/web/src/ui/dialog.tsx']);
  assert.equal(result.full, true);
  assert.equal(result.visual, true);
});

test('a snapshot change runs visual verification without broad interactions', () => {
  const result = selectBrowserTests([
    'apps/web/tests/screens.spec.ts-snapshots/dialog-dark-phone-win32.png',
  ]);
  assert.equal(result.full, false);
  assert.equal(result.visual, true);
});

test('shared fixtures exercise both full interaction and visual suites', () => {
  const result = selectBrowserTests(['apps/web/tests/fixtures.ts']);
  assert.equal(result.full, true);
  assert.equal(result.visual, true);
});

test('unknown web code defaults to full interaction coverage', () => {
  const result = selectBrowserTests(['apps/web/src/new-browser-area.ts']);
  assert.equal(result.full, true);
});
