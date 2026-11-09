import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/**
 * Splits one interaction project across several CI runners.
 *
 * Each runner still uses one worker, because frame measurements need the
 * machine to themselves. Playwright's own `--shard` cuts the file list into
 * contiguous runs of equal test count, which puts every slow offline file on
 * the same runner. This assigns whole files by measured duration instead
 * (longest first, each to the least loaded runner), so the runners finish
 * close together. Every runner computes the same split from the same inputs.
 */

/** Seconds assumed for a file the duration table has not measured yet. */
export const UNKNOWN_FILE_SECONDS = 20;

export function shardFiles(files, durations, index, total) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`Invalid shard total: ${total}`);
  if (!Number.isInteger(index) || index < 1 || index > total)
    throw new Error(`Invalid shard index: ${index} of ${total}`);
  const weighted = [...new Set(files)]
    .map((file) => [file, durations[file.split('/').at(-1)] ?? UNKNOWN_FILE_SECONDS])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const loads = Array.from({ length: total }, () => ({ seconds: 0, files: [] }));
  for (const [file, seconds] of weighted) {
    let lightest = loads[0];
    for (const load of loads) if (load.seconds < lightest.seconds) lightest = load;
    lightest.seconds += seconds;
    lightest.files.push(file);
  }
  return { files: loads[index - 1].files.sort(), seconds: loads[index - 1].seconds };
}

/** Files a project would run, as `tests/<name>.spec.ts`, from Playwright's JSON listing. */
export function listedFiles(report) {
  const files = new Set();
  const visit = (suite) => {
    if (suite.file && suite.specs?.length) files.add(`tests/${suite.file.split(/[\\/]/).at(-1)}`);
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return [...files].sort();
}

if (process.argv[1]?.endsWith('shard-browser-tests.mjs')) {
  const project = process.env['BROWSER_PROJECT'];
  const full = process.env['BROWSER_FULL'] === 'true';
  const selected = (process.env['BROWSER_FILES'] ?? '').split(/\s+/).filter(Boolean);
  const index = Number(process.env['SHARD_INDEX']);
  const total = Number(process.env['SHARD_TOTAL']);
  if (!['phone-interaction', 'desktop-interaction'].includes(project))
    throw new Error(`Unknown interaction project: ${project}`);
  if (!full && !selected.length) throw new Error('Targeted coverage requires selected files');

  // Listing applies the project's own testMatch/testIgnore, so a runner never
  // receives a file its project would refuse with "No tests found".
  const listing = execFileSync(
    'pnpm',
    [
      '--filter',
      '@neuron/web',
      'exec',
      'playwright',
      'test',
      '--list',
      '--reporter=json',
      `--project=${project}`,
      ...(full ? [] : selected),
    ],
    { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 },
  );
  const report = JSON.parse(listing.slice(listing.indexOf('{')));
  const durations =
    JSON.parse(readFileSync('apps/web/tests/browser-durations.json', 'utf8'))[project] ?? {};
  const shard = shardFiles(listedFiles(report), durations, index, total);
  const output = `files=${shard.files.join(' ')}\n`;
  if (process.env['GITHUB_OUTPUT']) appendFileSync(process.env['GITHUB_OUTPUT'], output);
  console.log(
    `${project} shard ${index}/${total}: ${shard.files.length} files, about ${shard.seconds} s`,
  );
  for (const file of shard.files) console.log(`  ${file}`);
}
