import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const surfaceSpecs = {
  auth: ['keyboard.spec.ts'],
  import: ['import.spec.ts'],
  library: ['collection-integrity.spec.ts', 'recovery-regressions.spec.ts'],
  notes: [
    'note-list.spec.ts',
    'note-conversion.spec.ts',
    'grammar-stabilization.spec.ts',
    'iphone-ux.spec.ts',
    'rich-study.spec.ts',
  ],
  settings: ['motion.spec.ts', 'keyboard.spec.ts'],
  today: ['study.spec.ts', 'stabilization.spec.ts', 'rich-study.spec.ts'],
};

export function selectBrowserTests(paths, forcedFull = false) {
  const selected = new Set(['smoke.spec.ts']);
  let full = forcedFull;
  let visual = forcedFull;

  for (const path of paths) {
    if (/^apps\/web\/tests\/(?:gallery|screens)\.spec\.ts(?:-snapshots\/|$)/.test(path)) {
      visual = true;
      continue;
    }
    if (/^apps\/web\/tests\/.+\.spec\.ts$/.test(path)) {
      selected.add(path.split('/').at(-1));
      continue;
    }
    if (/^apps\/web\/tests\//.test(path)) {
      full = true;
      if (/^apps\/web\/tests\/fixtures\.ts$/.test(path)) visual = true;
      continue;
    }
    if (/^apps\/web\/src\/features\/([^/]+)\//.test(path)) {
      const surface = path.split('/')[4];
      if (surfaceSpecs[surface]) {
        for (const spec of surfaceSpecs[surface]) selected.add(spec);
      } else {
        full = true;
        if (surface === 'dev') visual = true;
      }
      continue;
    }
    if (
      /^(apps\/web\/(?:src\/(?:app|lib|preferences|router|styles|theme|ui)\/|src\/router\.tsx|playwright\.config\.ts|package\.json|vite\.config\.ts)|packages\/(?:core|shared|config)\/|(?:package\.json|pnpm-lock\.yaml)$)/.test(
        path,
      )
    ) {
      full = true;
      if (/^(apps\/web\/src\/(?:styles|theme|ui)\/|packages\/config\/)/.test(path)) visual = true;
      continue;
    }
    if (/^apps\/web\/src\//.test(path)) {
      full = true;
      if (/^apps\/web\/src\/i18n\//.test(path)) visual = true;
      continue;
    }
    if (
      /^(?:\.github\/workflows\/(?:ci|full-browser-regression)\.yml|scripts\/select-browser-tests\.(?:mjs|test\.mjs))$/.test(
        path,
      )
    ) {
      full = true;
      visual = true;
    }
  }

  return {
    full,
    visual,
    files: full ? [] : [...selected].sort().map((name) => `tests/${name}`),
  };
}

if (process.argv[1]?.endsWith('select-browser-tests.mjs')) {
  const base = process.env['BROWSER_BASE_SHA'];
  const forcedFull = process.env['BROWSER_FULL'] === 'true';
  const paths = base
    ? execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
    : [];
  const result = selectBrowserTests(paths, forcedFull || !base);
  const output = `full=${result.full}\nvisual=${result.visual}\nfiles=${result.files.join(' ')}\n`;
  if (process.env['GITHUB_OUTPUT']) appendFileSync(process.env['GITHUB_OUTPUT'], output);
  console.log(`Browser selection: ${JSON.stringify({ paths, ...result })}`);
}
