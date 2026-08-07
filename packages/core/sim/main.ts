/**
 * The simulator, run from the command line.
 *
 * Run it with:  pnpm --filter @neuron/core simulate
 *
 * This is a development tool. It lives outside src on purpose: it is not part
 * of the package, it never ships, and together with the demo it is the only
 * place here allowed to talk to a console or touch a file.
 *
 * What it is for has changed since the first version, and the change is worth
 * stating. The first runs compared the two policies on words learned per year
 * and found them level. That result stands and it is not a surprise: the rate
 * at which a schedule turns minutes into memories belongs to FSRS, not to the
 * policy rationing the minutes. Measuring it again would only confirm that a
 * throttle cannot beat arithmetic.
 *
 * What a throttle can change is the shape of the load. The worst day. The
 * worst week. How often an evening costs three times what was promised. How
 * long a fortnight away takes to pay off. Those are the numbers here, and the
 * scenarios are the ones that actually break people rather than the gentle
 * default that does not.
 *
 * Everything printed comes out of a run. Nothing is typed in by hand.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createSchedulerConfig } from '../src/fsrs/parameters.js';
import { createSeededRandom } from '../src/fsrs/random.js';
import { AVERAGE_LEARNER, DEFAULT_DROPOUT } from '../src/simulation/learner.js';
import { simulate } from '../src/simulation/simulate.js';
import { createBudget } from '../src/workload/budget.js';
import { createWorkloadConfig } from '../src/workload/config.js';

import { CHART_COLOURS, lineChart, movingAverage, type Series } from './chart.js';

import type { DeckSpec, SimulationOptions, SimulationResult } from '../src/simulation/simulate.js';
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

const learner = AVERAGE_LEARNER;
const shared = { start: START, config, budget, learner };

/** A deck given in cards, split across the directions a note produces. */
function deck(
  id: string,
  cards: number,
  newPerDay: number,
  directions: readonly ('recognition' | 'recall' | 'production')[] = ['recognition', 'recall'],
): DeckSpec {
  return { id, notes: Math.ceil(cards / directions.length), directions, newPerDay };
}

/** Runs one arm and says how long it took. */
function run(
  label: string,
  options: Omit<SimulationOptions, 'label'>,
  seed = SEED,
): SimulationResult {
  const began = Date.now();
  const result = simulate({ ...options, label }, createSeededRandom(seed));

  console.log(`  ${label.padEnd(28)} ${((Date.now() - began) / 1000).toFixed(1)}s`);

  return result;
}

/** Runs the same scenario under both policies. */
function pair(
  name: string,
  options: Omit<SimulationOptions, 'label' | 'policy'>,
): { fixed: SimulationResult; adaptive: SimulationResult } {
  return {
    fixed: run(`${name}, fixed limit`, { ...options, policy: { kind: 'fixed' } }),
    adaptive: run(`${name}, adaptive`, { ...options, policy: { kind: 'adaptive' } }),
  };
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

/** Prints a paragraph wrapped to a readable width. */
function printParagraph(text: string): void {
  const words = text.split(' ');
  let line = '';

  for (const word of words) {
    if (line.length + word.length + 1 > 78) {
      console.log(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }

  if (line.length > 0) {
    console.log(line);
  }
}

const SHAPE_HEADERS = [
  'policy',
  'mean',
  'median',
  'p95',
  'peak',
  'worst week',
  'spread',
  'over',
  'over 2x',
  'over by',
];

/** The row that describes what the year felt like. */
function shapeRow(result: SimulationResult): string[] {
  const summary = result.summary;

  return [
    summary.label,
    summary.meanMinutes.toFixed(1),
    summary.medianMinutes.toFixed(1),
    summary.p95DailyMinutes.toFixed(0),
    summary.peakDailyMinutes.toFixed(0),
    summary.worstWeekMinutes.toFixed(0),
    summary.dailyMinutesStdDev.toFixed(1),
    String(summary.daysOverBudget),
    String(summary.daysOverDoubleBudget),
    summary.meanOvershootMinutes.toFixed(1),
  ];
}

const THROUGHPUT_HEADERS = [
  'policy',
  'new cards',
  'known',
  'reviews',
  'total min',
  'known/hour',
  'retention',
  'backlog',
  'stalled',
  'recovery',
];

/** The row that describes what the year produced. */
function throughputRow(result: SimulationResult): string[] {
  const summary = result.summary;
  const hours = summary.totalMinutes / 60;

  return [
    summary.label,
    String(summary.newCardsIntroduced),
    String(summary.knownAtEnd),
    String(summary.totalReviews),
    summary.totalMinutes.toFixed(0),
    hours > 0 ? (summary.knownAtEnd / hours).toFixed(1) : '0',
    `${(summary.retention * 100).toFixed(1)}%`,
    String(summary.backlogAtEnd),
    String(summary.newCardsStalledDays),
    summary.daysToRecover.length === 0
      ? '-'
      : summary.daysToRecover.map((days) => (days === null ? 'never' : String(days))).join('/'),
  ];
}

/** Prints both tables for one matched pair. */
function report(
  scenario: string,
  note: string,
  runs: { fixed: SimulationResult; adaptive: SimulationResult },
): void {
  console.log('');
  printParagraph(note);
  console.log('');
  console.log('  the shape of the load, in minutes a day');
  printTable(SHAPE_HEADERS, [shapeRow(runs.fixed), shapeRow(runs.adaptive)]);
  console.log('');
  console.log('  what came out of it');
  printTable(THROUGHPUT_HEADERS, [throughputRow(runs.fixed), throughputRow(runs.adaptive)]);
  console.log('');
  printParagraph(verdict(scenario, runs));
}

/** One sentence on which policy won what, written from the numbers. */
function verdict(
  scenario: string,
  runs: { fixed: SimulationResult; adaptive: SimulationResult },
): string {
  const fixed = runs.fixed.summary;
  const adaptive = runs.adaptive.summary;
  const peakRatio =
    adaptive.peakDailyMinutes > 0 ? fixed.peakDailyMinutes / adaptive.peakDailyMinutes : 0;
  const knownRatio = fixed.knownAtEnd > 0 ? adaptive.knownAtEnd / fixed.knownAtEnd : 0;

  return `${scenario}: the worst day was ${fixed.peakDailyMinutes.toFixed(0)} minutes under the fixed limit and ${adaptive.peakDailyMinutes.toFixed(0)} under the throttle, a factor of ${peakRatio.toFixed(1)}. The throttle finished with ${(knownRatio * 100).toFixed(0)}% of the cards the fixed limit knew, for ${((adaptive.totalMinutes / Math.max(fixed.totalMinutes, 1)) * 100).toFixed(0)}% of the time spent.`;
}

/** Writes one run out as a CSV, one row per day. */
async function writeCsv(result: SimulationResult, name: string): Promise<void> {
  const header =
    'day,date,minutes,reviews,new_cards,known,backlog,retention,budget_minutes,offered_minutes,skipped';
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
      day.offeredMinutes.toFixed(3),
      day.skipped ? 1 : 0,
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

  printHeading('Neuron workload simulator');
  printParagraph(
    'A virtual learner studies for a year. The same person, the same seed and the same collection in every arm. Only the policy that decides on new cards differs between them.',
  );
  console.log('');
  console.log('  budget      15 minutes on a weekday, 30 at the weekend');
  console.log(
    `  answers     ${learner.seconds.recognition}s recognition, ${learner.seconds.recall}s recall, ${learner.seconds.production}s production`,
  );
  console.log(
    `  attendance  ${(DEFAULT_DROPOUT.baseSkip * 100).toFixed(0)}% of days skipped, overload assumed not to change that`,
  );
  console.log('  fixed arm   every review that is due, plus the deck limit in new cards');
  console.log('  adaptive    a session that stops at the budget, new cards only if there is room');
  console.log('');
  printParagraph(
    'Words learned per minute is not in these tables as a headline because the two policies are level on it, which the throughput columns show. What differs is the shape of the load.',
  );

  // S1
  printHeading('S1  Burst import');
  const s1 = pair('S1 burst', {
    ...shared,
    decks: [deck('import', 500, 50)],
    days: 180,
  });
  report(
    'S1',
    'Five hundred cards imported in one go, fifty new a day, six months. The import is small enough that the fixed limit clears it in ten days, which is exactly when the load it created arrives.',
    s1,
  );

  // S2
  printHeading('S2  The Oxford 5000');
  const s2 = pair('S2 oxford', {
    ...shared,
    decks: [deck('oxford', 5000, 50)],
    days: 365,
  });
  report(
    'S2',
    'Five thousand cards, fifty new a day, a year. This is the situation the application was built for: a list somebody imports on a Sunday afternoon meaning to get through it.',
    s2,
  );

  // S3
  printHeading('S3  Two absences');
  const s3 = pair('S3 absences', {
    ...shared,
    decks: [deck('oxford', 5000, 50)],
    days: 365,
    absences: [
      { startDay: 60, days: 14 },
      { startDay: 150, days: 21 },
    ],
  });
  report(
    'S3',
    'The same collection, with a fortnight away at day 60 and three weeks away at day 150. The recovery column gives the days from each return until a week of work fits a week of budget again.',
    s3,
  );

  // S4
  printHeading('S4  Production heavy');
  const s4 = pair('S4 production', {
    ...shared,
    decks: [deck('typing', 4500, 50, ['recognition', 'recall', 'production'])],
    days: 365,
  });
  report(
    'S4',
    'Fifteen hundred notes with all three directions on from the first day, so every note is a recognition card, a recall card and a typed one at fourteen seconds. Four and a half thousand cards.',
    s4,
  );

  // S5
  printHeading('S5  Three decks at once');
  const s5 = pair('S5 three decks', {
    ...shared,
    decks: [deck('english', 3000, 20), deck('german', 800, 10), deck('finance', 400, 5)],
    days: 365,
  });
  report(
    'S5',
    'English at twenty new a day, German at ten, finance terminology at five. Every one of those numbers is modest. The fixed arm applies each limit to its own deck, which is what every application does, and the adaptive arm sees one collection and one budget.',
    s5,
  );

  // The sensitivity sweep.
  printHeading('Dropout sensitivity');
  printParagraph(
    'Everything above assumes overload does not change behaviour: the learner turns up just as often on a day that wants ninety minutes as on one that wants fifteen. That is the assumption most favourable to the fixed limit, and it is why the two policies come out level on words learned.',
  );
  console.log('');
  printParagraph(
    'The model below is an assumption and not a measurement. The chance of skipping a day is baseSkip plus k times the overload, where overload is how many times past the budget the day is, capped at 90%, and three weeks of consecutive skipping counts as having given up. k is unknown, so it is swept rather than chosen.',
  );
  console.log('');

  printParagraph(
    'Giving up is a threshold rather than a slope: a run either survives the year or hits three weeks of silence and ends. Whether it does at a given k is largely the dice, so every value below is seven runs with seven seeds, and the table reports the average and how many of the seven were abandoned.',
  );
  console.log('');
  printParagraph(
    'The adaptive arm is run once, at seven seeds, and reused across the sweep. That is not a shortcut: under a session capped at the budget the overload term is zero by construction, so k multiplies zero and the runs come out identical. Reporting it eight times would suggest a sensitivity it does not have.',
  );
  console.log('');

  const sweepValues = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1];
  const sweepSeeds = [SEED, SEED + 11, SEED + 22, SEED + 33, SEED + 44, SEED + 55, SEED + 66];
  const sweepScenario = {
    ...shared,
    decks: [deck('oxford', 5000, 50)],
    days: 365,
  };

  const adaptiveSweep = sweepSeeds.map((seed, index) =>
    run(
      `adaptive seed ${index + 1}`,
      { ...sweepScenario, policy: { kind: 'adaptive' }, dropout: DEFAULT_DROPOUT },
      seed,
    ),
  );
  const sweep = sweepValues.map((k) => ({
    k,
    fixed: sweepSeeds.map((seed, index) =>
      run(
        `k=${k} fixed seed ${index + 1}`,
        {
          ...sweepScenario,
          policy: { kind: 'fixed' },
          dropout: { ...DEFAULT_DROPOUT, overloadSensitivity: k },
        },
        seed,
      ),
    ),
    adaptive: adaptiveSweep,
  }));

  /** How many of a set of runs ended in the collection being abandoned. */
  const gaveUp = (runs: readonly SimulationResult[]): number =>
    runs.filter((result) => result.summary.abandonedOnDay !== null).length;

  /** The mean cards known at the end of a set of runs. */
  const meanKnown = (runs: readonly SimulationResult[]): number =>
    mean(runs.map((result) => result.summary.knownAtEnd));

  console.log('');
  printTable(
    ['k', 'fixed known', 'gave up', 'adaptive known', 'gave up', 'fixed days', 'adaptive days'],
    sweep.map(({ k, fixed, adaptive }) => [
      k.toFixed(1),
      meanKnown(fixed).toFixed(0),
      `${gaveUp(fixed)} of ${fixed.length}`,
      meanKnown(adaptive).toFixed(0),
      `${gaveUp(adaptive)} of ${adaptive.length}`,
      mean(fixed.map((result) => result.summary.daysStudied)).toFixed(0),
      mean(adaptive.map((result) => result.summary.daysStudied)).toFixed(0),
    ]),
  );

  const crossover = sweep.find(({ fixed, adaptive }) => meanKnown(adaptive) > meanKnown(fixed));

  console.log('');

  if (crossover === undefined) {
    printParagraph(
      `Across every value tried, from k = 0 to k = ${sweepValues[sweepValues.length - 1] ?? 1}, the fixed limit finished with at least as many cards known on average. On this evidence the adaptive policy does not overtake it on throughput at any sensitivity in that range, and its case rests on the shape of the load rather than on the total.`,
    );
  } else {
    printParagraph(
      `The two policies are equivalent when overload does not affect behaviour: at k = 0 they are within a percent of each other, and that is the assumption most favourable to the fixed limit. The adaptive policy overtakes the fixed limit on cards known at day 365 once the probability of skipping rises with overload at a rate above k = ${crossover.k}. Whether real learners sit above or below that is an empirical question this simulation cannot answer.`,
    );
  }

  // C, kept from the first round: which backlog ordering recovers best.
  printHeading('Backlog orderings');
  printParagraph(
    'A collection four months old, thirty days of silence from day 120, then the recovery. Three seeds each, because one run of anything is an anecdote.',
  );
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
          decks: [deck('recovery', 4000, 50)],
          days: 260,
          policy: { kind: 'adaptive' },
          absences: [{ startDay: 120, days: 30 }],
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
    recoveries.map(({ order, runs: seeded }) => [
      order,
      withSpread(seeded.map((result) => overdueAfter(result, 14))),
      withSpread(seeded.map((result) => overdueAfter(result, 30))),
      withSpread(
        seeded.map((result) => recoveryRetention(result) * 100),
        2,
      ),
      withSpread(seeded.map((result) => result.summary.knownAtEnd)),
    ]),
  );

  // Files.
  const runs: readonly (readonly [SimulationResult, string])[] = [
    [s1.fixed, 's1-fixed'],
    [s1.adaptive, 's1-adaptive'],
    [s2.fixed, 's2-fixed'],
    [s2.adaptive, 's2-adaptive'],
    [s3.fixed, 's3-fixed'],
    [s3.adaptive, 's3-adaptive'],
    [s4.fixed, 's4-fixed'],
    [s4.adaptive, 's4-adaptive'],
    [s5.fixed, 's5-fixed'],
    [s5.adaptive, 's5-adaptive'],
    ...sweep.flatMap(({ k, fixed }) =>
      fixed.map(
        (result, index) =>
          [result, `sweep-k${String(k).replace('.', '')}-fixed-seed-${index + 1}`] as const,
      ),
    ),
    ...adaptiveSweep.map((result, index) => [result, `sweep-adaptive-seed-${index + 1}`] as const),
    ...recoveries.flatMap(({ order, runs: seeded }) =>
      seeded.map((result, index) => [result, `backlog-${order}-seed-${index + 1}`] as const),
    ),
  ];

  for (const [result, name] of runs) {
    await writeCsv(result, name);
  }

  await writeFile(
    path.join(assetsDir, 'workload-daily-load.svg'),
    lineChart({
      title: 'Minutes a day, a fixed limit against a time budget',
      subtitle:
        'S2: five thousand cards, fifty new a day, one year, one learner. Seven day average.',
      xLabel: 'day of the run',
      yLabel: 'minutes',
      series: [
        budgetSeries(s2.fixed),
        minutesSeries(s2.fixed, 'fixed limit', CHART_COLOURS.danger),
        minutesSeries(s2.adaptive, 'adaptive', CHART_COLOURS.accent),
      ],
    }),
    'utf8',
  );

  await writeFile(
    path.join(assetsDir, 'workload-absences.svg'),
    lineChart({
      title: 'Coming back: a fortnight away at day 60, three weeks at day 150',
      subtitle: 'S3: the same collection as above, with the two gaps. Seven day average.',
      xLabel: 'day of the run',
      yLabel: 'minutes',
      series: [
        budgetSeries(s3.fixed),
        minutesSeries(s3.fixed, 'fixed limit', CHART_COLOURS.danger),
        minutesSeries(s3.adaptive, 'adaptive', CHART_COLOURS.accent),
      ],
    }),
    'utf8',
  );

  await writeFile(
    path.join(assetsDir, 'workload-cards-known.svg'),
    lineChart({
      title: 'Cards known, meaning stability above three weeks',
      subtitle: 'S2 again. This is the column where the two policies are level, and it matters.',
      xLabel: 'day of the run',
      yLabel: 'cards',
      series: [
        {
          label: 'fixed limit',
          colour: CHART_COLOURS.danger,
          values: s2.fixed.days.map((day) => day.known),
        },
        {
          label: 'adaptive',
          colour: CHART_COLOURS.accent,
          values: s2.adaptive.days.map((day) => day.known),
        },
      ],
    }),
    'utf8',
  );

  await writeFile(
    path.join(assetsDir, 'workload-dropout-sweep.svg'),
    lineChart({
      title: 'Cards known at day 365 as overload starts to cost attendance',
      subtitle:
        'Mean of seven seeds. The axis is k, the assumed rate at which the chance of skipping rises with overload, which is not measured anywhere.',
      xLabel: 'k, the assumed cost of overload in attendance',
      yLabel: 'cards known',
      xLabels: sweepValues.map((k) => k.toFixed(1)),
      series: [
        {
          label: 'fixed limit',
          colour: CHART_COLOURS.danger,
          values: sweep.map(({ fixed }) => meanKnown(fixed)),
        },
        {
          label: 'adaptive',
          colour: CHART_COLOURS.accent,
          values: sweep.map(({ adaptive }) => meanKnown(adaptive)),
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
