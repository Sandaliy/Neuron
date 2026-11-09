import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/**
 * Rebuilds apps/web/tests/browser-durations.json from a finished CI run.
 *
 *   node scripts/browser-durations.mjs <run-id>
 *
 * Use a run whose browser selection was full, so every file is measured. Each
 * job log carries a timestamp per line, and the line reporter prints one line
 * as each test starts, so a test's duration is the gap to the next line.
 */

const PROJECTS = ['phone-interaction', 'desktop-interaction'];

export function fileSeconds(log) {
  const lines = log.split(/\r?\n/);
  const starts = [];
  for (const line of lines) {
    const match = line.match(/^(\S+Z) \[\d+\/\d+\] \[[^\]]+\] › tests\/(\S+?\.spec\.ts)/);
    if (match) starts.push([Date.parse(match[1]), match[2]]);
  }
  if (!starts.length) return {};
  const summary = lines.find((line) => /^\S+Z\s+\d+ passed/.test(line));
  const end = summary ? Date.parse(summary.split(' ')[0]) : starts.at(-1)[0];
  const seconds = {};
  starts.forEach(([at, file], index) => {
    seconds[file] = (seconds[file] ?? 0) + ((starts[index + 1]?.[0] ?? end) - at) / 1000;
  });
  return seconds;
}

if (process.argv[1]?.endsWith('browser-durations.mjs')) {
  const run = process.argv[2];
  if (!/^\d+$/.test(run ?? ''))
    throw new Error('Usage: node scripts/browser-durations.mjs <run-id>');
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const jobs = JSON.parse(gh(['run', 'view', run, '--json', 'jobs'])).jobs;
  const table = {};
  for (const project of PROJECTS) {
    const measured = {};
    for (const job of jobs.filter((candidate) => candidate.name.includes(project))) {
      Object.assign(
        measured,
        fileSeconds(
          gh(['run', 'view', '--job', String(job.databaseId), '--log'])
            .split(/\r?\n/)
            // `gh run view --log` prefixes each line with the job and step names.
            .map((line) => line.split('\t').at(-1))
            .join('\n'),
        ),
      );
    }
    if (!Object.keys(measured).length) throw new Error(`No ${project} test lines in run ${run}`);
    table[project] = Object.fromEntries(
      Object.entries(measured)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, seconds]) => [file, Math.max(1, Math.round(seconds))]),
    );
  }
  writeFileSync('apps/web/tests/browser-durations.json', `${JSON.stringify(table, null, 2)}\n`);
  for (const project of PROJECTS)
    console.log(`${project}: ${Object.keys(table[project]).length} files measured`);
}
