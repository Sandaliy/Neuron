/**
 * The simulator, run from the command line.
 *
 * Run it with:  pnpm --filter @neuron/core simulate
 *
 * This is a development tool. It lives outside src on purpose: it is not part
 * of the package, it never ships, and together with the demo it is the only
 * place here allowed to talk to a console or touch a file.
 *
 * It answers three questions.
 *
 *   A against B  what a fixed daily limit of new cards does to the workload
 *                over a year, against a limit derived from a time budget
 *   the same two on a collection large enough that the fixed limit never runs
 *                out of cards to hand out
 *   C            which of the three backlog orderings recovers best from a
 *                month away
 *
 * Everything it prints comes out of the run. Nothing is typed in by hand.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createSchedulerConfig } from '../src/fsrs/parameters.js';
import { createSeededRandom } from '../src/fsrs/random.js';
import { AVERAGE_LEARNER } from '../src/simulation/learner.js';
import { simulate } from '../src/simulation/simulate.js';
import { createBudget } from '../src/workload/budget.js';
import { createWorkloadConfig } from '../src/workload/config.js';

import { CHART_COLOURS, lineChart, movingAverage, type Series } from './chart.js';

import type { SimulationResult } from '../src/simulation/simulate.js';
import type { BacklogOrder } from '../src/workload/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const outputDir = path.join(here, '..', '.sim-output');
const assetsDir = path.join(repoRoot, 'docs', 'assets');

/** The seed every run shares, so the learner is the same person in each arm. */
const SEED = 20_260_807;

/** When the runs start. A Monday, so the weeks line up with the budget. */
const START = new Date('2026-01-05T12:00:00Z');

/** Fifteen minutes on a weekday, half an hour at the weekend. */
const budget = createBudget({ minutesByWeekday: [30, 15, 15, 15, 15, 15, 30] });

/** The settings both arms share. Only the policy differs between them. */
const config = createWorkloadConfig({
  scheduler: createSchedulerConfig({ timezone: 'UTC', dayCutoffHour: 4 }),
  budget,
});

/** Runs one arm and prints how long it took. */
function run(
  label: string,
  options: Omit<Parameters<typeof simulate>[0], 'label'>,
  seed = SEED,
): SimulationResult {
  const began = Date.now();
  const result = simulate({ ...options, label }, createSeededRandom(seed));

  console.log(`  ${label} finished in ${((Date.now() - began) / 1000).toFixed(1)}s`);

  return result;
}

/** The mean of a handful of numbers. */
function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

/** Lines up the columns and prints a table. */
function printTable(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0),
      )
      .join('  ');

  console.log(`  ${line(headers)}`);
  console.log(`  ${widths.map((width) => '-'.repeat(width)).join('  ')}`);

  for (const row of rows) {
    console.log(`  ${line(row)}`);
  }
}

/** Prints a heading with a rule under it. */
function printHeading(title: string): void {
  console.log('');
  console.log(title);
  console.log('='.repeat(title.length));
  console.log('');
}

/** One row of the summary table. */
function summaryRow(result: SimulationResult): string[] {
  const summary = result.summary;

  return [
    summary.label,
    summary.meanMinutes.toFixed(1),
    summary.medianMinutes.toFixed(1),
    summary.minutesAroundDay90.toFixed(1),
    summary.minutesAtEnd.toFixed(1),
    summary.peakMinutes.toFixed(0),
    summary.meanOvershootMinutes.toFixed(1),
    String(summary.daysOverBudget),
    String(summary.newCardsIntroduced),
    String(summary.knownAtEnd),
    `${(summary.retention * 100).toFixed(1)}%`,
  ];
}

const SUMMARY_HEADERS = [
  'run',
  'mean min',
  'median',
  'day 90',
  'at the end',
  'peak',
  'over by',
  'days over',
  'new cards',
  'known',
  'retention',
];

/** Writes one run out as a CSV, one row per day. */
async function writeCsv(result: SimulationResult, name: string): Promise<void> {
  const header = 'day,date,minutes,reviews,new_cards,known,backlog,retention,budget_minutes';
  const rows = result.days.map((day) =>
    [
      day.day,
      day.date.toISOString().slice(0, 10),
      day.minutes.toFixed(3),
      day.reviews,
      day.newCards,
      day.known,
      day.backlog,
      day.retention === null ? '' : day.retention.toFixed(4),
      day.budgetMinutes,
    ].join(','),
  );

  await writeFile(path.join(outputDir, `${name}.csv`), `${header}\n${rows.join('\n')}\n`, 'utf8');
}

/** The daily minutes of a run, smoothed for drawing. */
function minutesSeries(result: SimulationResult, label: string, colour: string): Series {
  return { label, colour, values: movingAverage(result.days.map((day) => day.minutes)) };
}

/** The budget line, for drawing under the two policies. */
function budgetSeries(result: SimulationResult): Series {
  return {
    label: 'budget',
    colour: CHART_COLOURS.dim,
    values: movingAverage(result.days.map((day) => day.budgetMinutes)),
    dashed: true,
  };
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  const learner = AVERAGE_LEARNER;
  const shared = { start: START, config, budget, learner };

  printHeading('Neuron workload simulator');
  console.log('A virtual learner studies for a year. The same person, the same seed, the same');
  console.log('deck in every arm. Only the policy that decides on new cards differs.');
  console.log('');
  console.log(`  budget      15 minutes on a weekday, 30 at the weekend`);
  console.log(`  learner     ${learner.name}, ${learner.skippedDaysPerMonth} days skipped a month`);
  console.log(
    `  answers     ${learner.seconds.recognition}s recognition, ${learner.seconds.recall}s recall, ${learner.seconds.production}s production`,
  );
  console.log('  deck        three cards to a note: recognition, recall, production');
  console.log('');

  printHeading('A against B, a deck of 5000 cards over a year');

  const fixed = run('A fixed 20 a day', {
    ...shared,
    deckSize: 5000,
    days: 365,
    policy: { kind: 'fixed', perDay: 20 },
  });
  const adaptive = run('B adaptive', {
    ...shared,
    deckSize: 5000,
    days: 365,
    policy: { kind: 'adaptive' },
  });

  console.log('');
  printTable(SUMMARY_HEADERS, [summaryRow(fixed), summaryRow(adaptive)]);

  printHeading('The same two on a collection that does not run out');

  const fixedLarge = run('A fixed, 15000 cards', {
    ...shared,
    deckSize: 15_000,
    days: 365,
    policy: { kind: 'fixed', perDay: 20 },
  });
  const adaptiveLarge = run('B adaptive, 15000 cards', {
    ...shared,
    deckSize: 15_000,
    days: 365,
    policy: { kind: 'adaptive' },
  });

  console.log('');
  printTable(SUMMARY_HEADERS, [summaryRow(fixedLarge), summaryRow(adaptiveLarge)]);

  printHeading('C, three ways out of a month away');
  console.log('A collection that has been running for four months, thirty days of silence from');
  console.log('day 120, then the recovery. Three seeds each, because one run of anything is an');
  console.log('anecdote.');
  console.log('');

  const orders: readonly BacklogOrder[] = ['byDueDate', 'byRetrievability', 'bySalvageValue'];
  const seeds = [SEED, SEED + 101, SEED + 202];
  const recoveries = orders.map((order) => ({
    order,
    runs: seeds.map((seed, index) =>
      run(
        `${order} seed ${index + 1}`,
        {
          ...shared,
          config: createWorkloadConfig({
            scheduler: config.scheduler,
            budget,
            backlogOrder: order,
          }),
          deckSize: 4000,
          days: 260,
          policy: { kind: 'adaptive' },
          absence: { startDay: 120, days: 30 },
        },
        seed,
      ),
    ),
  }));

  /** What is still overdue a given number of days after the learner returns. */
  const overdueAfter = (result: SimulationResult, days: number): number =>
    result.days.find((day) => day.day === 150 + days)?.backlog ?? 0;

  /** The share recalled over the recovery, which is what the ordering is for. */
  const recoveryRetention = (result: SimulationResult): number => {
    const tested = result.days.filter((day) => day.day >= 150 && day.retention !== null);

    return mean(tested.map((day) => day.retention ?? 0));
  };

  /** A mean with the spread across the seeds behind it, so nobody over reads it. */
  const withSpread = (values: readonly number[], decimals = 0): string =>
    `${mean(values).toFixed(decimals)} (${Math.min(...values).toFixed(decimals)} to ${Math.max(...values).toFixed(decimals)})`;

  console.log('');
  printTable(
    ['ordering', 'overdue at +14', 'at +30', 'retention after', 'known at end'],
    recoveries.map(({ order, runs }) => [
      order,
      withSpread(runs.map((result) => overdueAfter(result, 14))),
      withSpread(runs.map((result) => overdueAfter(result, 30))),
      withSpread(
        runs.map((result) => recoveryRetention(result) * 100),
        2,
      ),
      withSpread(runs.map((result) => result.summary.knownAtEnd)),
    ]),
  );

  const runs: readonly (readonly [SimulationResult, string])[] = [
    [fixed, 'a-fixed-5000'],
    [adaptive, 'b-adaptive-5000'],
    [fixedLarge, 'a-fixed-15000'],
    [adaptiveLarge, 'b-adaptive-15000'],
    ...recoveries.flatMap(({ order, runs: seeded }) =>
      seeded.map((result, index) => [result, `c-${order}-seed-${index + 1}`] as const),
    ),
  ];

  for (const [result, name] of runs) {
    await writeCsv(result, name);
  }

  await writeFile(
    path.join(assetsDir, 'workload-fixed-against-adaptive.svg'),
    lineChart({
      title: 'Minutes a day: a fixed limit of 20 new cards against a time budget',
      subtitle:
        'One learner, one deck of 5000 cards, one year. Seven day average of the daily minutes.',
      xLabel: 'day of the run',
      yLabel: 'minutes',
      series: [
        budgetSeries(fixed),
        minutesSeries(fixed, 'A, 20 new a day', CHART_COLOURS.danger),
        minutesSeries(adaptive, 'B, adaptive', CHART_COLOURS.accent),
      ],
    }),
    'utf8',
  );

  await writeFile(
    path.join(assetsDir, 'workload-large-collection.svg'),
    lineChart({
      title: 'The same two policies on a collection that never runs out',
      subtitle:
        '15000 cards, so the fixed limit keeps handing out 20 a day all year. Seven day average.',
      xLabel: 'day of the run',
      yLabel: 'minutes',
      series: [
        budgetSeries(fixedLarge),
        minutesSeries(fixedLarge, 'A, 20 new a day', CHART_COLOURS.danger),
        minutesSeries(adaptiveLarge, 'B, adaptive', CHART_COLOURS.accent),
      ],
    }),
    'utf8',
  );

  await writeFile(
    path.join(assetsDir, 'workload-cards-known.svg'),
    lineChart({
      title: 'Cards known, meaning stability above three weeks',
      subtitle: 'The price of staying inside the budget, on the deck of 5000.',
      xLabel: 'day of the run',
      yLabel: 'cards',
      series: [
        {
          label: 'A, 20 new a day',
          colour: CHART_COLOURS.danger,
          values: fixed.days.map((day) => day.known),
        },
        {
          label: 'B, adaptive',
          colour: CHART_COLOURS.accent,
          values: adaptive.days.map((day) => day.known),
        },
      ],
    }),
    'utf8',
  );

  await writeFile(
    path.join(assetsDir, 'workload-backlog-recovery.svg'),
    lineChart({
      title: 'Getting straight after thirty days away',
      subtitle:
        'Cards overdue, three orderings, three seeds each. The lines sit on top of each other.',
      xLabel: 'day of the run',
      yLabel: 'cards overdue',
      xStart: 110,
      series: recoveries.map(({ order, runs: seeded }, index) => ({
        label: order,
        colour:
          [CHART_COLOURS.accent, CHART_COLOURS.warn, CHART_COLOURS.success][index] ??
          CHART_COLOURS.dim,
        // The mean of the three seeds, so the line is the ordering rather than
        // one run's luck.
        values: (seeded[0]?.days ?? [])
          .slice(110)
          .map((_unused, offset) =>
            mean(seeded.map((result) => result.days[110 + offset]?.backlog ?? 0)),
          ),
      })),
    }),
    'utf8',
  );

  console.log('');
  console.log(`CSV per run written to ${path.relative(repoRoot, outputDir)}`);
  console.log(`Charts written to ${path.relative(repoRoot, assetsDir)}`);
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
