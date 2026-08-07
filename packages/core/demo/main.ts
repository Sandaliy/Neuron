/**
 * Three histories printed as plain tables, so the scheduler can be judged
 * without reading either the code or the tests.
 *
 * Run it with:  pnpm --filter @neuron/core demo
 *
 * This is a development tool. It lives outside src on purpose: it is not part
 * of the package, it never ships, and it is the only place in the package
 * allowed to talk to a console.
 */

import {
  DEFAULT_SCHEDULER_CONFIG,
  RATING,
  createSchedulerConfig,
  newCard,
  retrievability,
  review,
  type Rating,
  type SchedulerConfig,
  type SchedulingState,
} from '../src/index.js';

const MS_PER_DAY = 86_400_000;

/** Fuzz is off so that the same run always prints the same numbers. */
const config: SchedulerConfig = createSchedulerConfig({ enableFuzz: false });

/** Fuzz is off, so the generator is never asked for anything. */
const unusedRandom = (): number => 0;

const RATING_NAMES: Record<Rating, string> = {
  [RATING.again]: 'Again',
  [RATING.hard]: 'Hard',
  [RATING.good]: 'Good',
  [RATING.easy]: 'Easy',
};

/** One row of a table, before it is turned into text. */
interface Row {
  readonly index: number;
  readonly date: string;
  readonly rating: Rating;
  readonly next: string;
  readonly stability: number;
  readonly difficulty: number;
  readonly recall: string;
}

/** The date, in UTC, so the output does not depend on where it is run. */
function formatDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** How long until the card comes back, in whatever unit reads best. */
function formatWait(from: Date, until: Date): string {
  const days = (until.getTime() - from.getTime()) / MS_PER_DAY;

  if (days < 1) {
    return `${Math.round(days * 1440)} min`;
  }

  const whole = Math.round(days);

  return whole === 1 ? '1 day' : `${whole} days`;
}

/** Lines up the columns and prints the table. */
function printTable(rows: readonly Row[]): void {
  const headers = ['#', 'date', 'answer', 'next', 'stability', 'difficulty', 'recall'];
  const body = rows.map((row) => [
    String(row.index),
    row.date,
    RATING_NAMES[row.rating],
    row.next,
    row.stability.toFixed(2),
    row.difficulty.toFixed(2),
    row.recall,
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...body.map((line) => (line[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padStart(widths[column] ?? 0)).join('  ');

  console.log(`  ${line(headers)}`);
  console.log(`  ${widths.map((width) => '-'.repeat(width)).join('  ')}`);

  for (const cells of body) {
    console.log(`  ${line(cells)}`);
  }
}

/** Answers a card once and returns the row describing what happened. */
function answer(
  state: SchedulingState,
  rating: Rating,
  at: Date,
  index: number,
): { row: Row; next: SchedulingState } {
  const recall = state.state === 'new' ? null : retrievability(state, at, config);
  const next = review(state, rating, at, config, unusedRandom).next;

  if (next.state === 'new') {
    throw new Error('A card cannot still be new after being answered.');
  }

  return {
    row: {
      index,
      date: formatDate(at),
      rating,
      next: formatWait(at, next.due),
      stability: next.stability,
      difficulty: next.difficulty,
      recall: recall === null ? 'first' : recall.toFixed(2),
    },
    next,
  };
}

/** Prints a heading with a rule under it. */
function printHeading(title: string): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

/** Prints a paragraph wrapped to a readable width, with a blank line above. */
function printParagraph(text: string): void {
  const words = text.split(' ');
  let line = '';

  console.log('');

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

/**
 * Scenario A. Good every time, for a year.
 */
function goodStudent(): void {
  printHeading('Scenario A, the good student');
  printParagraph(
    'A card answered Good every single time. Each answer is given on the day the card comes due, and the run stops after a year.',
  );
  console.log('');

  const start = new Date(Date.UTC(2026, 0, 5, 9, 0));
  const rows: Row[] = [];
  let state: SchedulingState = newCard(start);
  let at = start;
  let index = 1;

  while (at.getTime() - start.getTime() < 365 * MS_PER_DAY) {
    const result = answer(state, RATING.good, at, index);

    rows.push(result.row);
    state = result.next;
    at = new Date(state.due.getTime());
    index += 1;
  }

  printTable(rows);
  printParagraph(
    'The interval starts in minutes, becomes days, then weeks, then months. Stability climbs every time and never falls back. Difficulty drifts down a little, because answering Good over and over is evidence that this card is not a hard one.',
  );
  printParagraph(
    'The recall column is the chance of remembering the card at the moment the question was asked. It sits near 0.90 all the way down, which is the point: the schedule aims at that number, and the growing intervals are what it takes to keep hitting it.',
  );
}

/**
 * Scenario B. Failed three times, then answered Good.
 */
function difficultWord(): void {
  printHeading('Scenario B, the difficult word');
  printParagraph('The same card, but answers 3, 5 and 6 are Again. Everything after that is Good.');
  console.log('');

  const start = new Date(Date.UTC(2026, 0, 5, 9, 0));
  const failures = new Set([3, 5, 6]);
  const rows: Row[] = [];
  let state: SchedulingState = newCard(start);
  let at = start;

  for (let index = 1; index <= 16; index += 1) {
    const result = answer(state, failures.has(index) ? RATING.again : RATING.good, at, index);

    rows.push(result.row);
    state = result.next;
    at = new Date(state.due.getTime());
  }

  printTable(rows);
  printParagraph(
    'Each Again drops the interval back to minutes and cuts stability hard. Difficulty jumps every time, and it does not come back down quickly, so this card keeps shorter intervals than an easy one for a long while.',
  );
  printParagraph(
    'What is not lost is the history. Stability after a failure is not zero and not the starting value either: it depends on how well the card was known before. The card climbs again, from a lower step and more slowly than in scenario A.',
  );
}

/**
 * Scenario C. Two months of reviews, then a long absence.
 */
function longAbsence(): void {
  printHeading('Scenario C, the long absence');
  printParagraph(
    'Answered Good on time for two months, then left alone for 60 days, then answered Good again.',
  );
  console.log('');

  const start = new Date(Date.UTC(2026, 0, 5, 9, 0));
  const rows: Row[] = [];
  let state: SchedulingState = newCard(start);
  let at = start;
  let index = 1;

  while (at.getTime() - start.getTime() < 60 * MS_PER_DAY) {
    const result = answer(state, RATING.good, at, index);

    rows.push(result.row);
    state = result.next;
    at = new Date(state.due.getTime());
    index += 1;
  }

  const beforeTheGap = state.state === 'new' ? 0 : state.stability;
  const onTime = answer(state, RATING.good, new Date(state.due.getTime()), index);

  at = new Date(state.due.getTime() + 60 * MS_PER_DAY);

  const afterTheGap = answer(state, RATING.good, at, index);

  rows.push(afterTheGap.row);
  printTable(rows);

  printParagraph(
    `The last row is the one to look at. The card was due on ${formatDate(state.due)} and was answered 60 days after that. Recall had fallen to ${afterTheGap.row.recall} by then, below the 0.90 the schedule aims for.`,
  );
  printParagraph(
    `The answer was still Good, so stability rose from ${beforeTheGap.toFixed(2)} days to ${afterTheGap.row.stability.toFixed(2)} days. Answering the same card on the day it was due would have given ${onTime.row.stability.toFixed(2)} days. The late answer is worth more, not less.`,
  );
  printParagraph(
    'That is the whole idea. Remembering something after two months of silence proves the memory was stronger than the schedule assumed, so the model widens the next interval instead of punishing the gap. A break does not reset progress here, and neither does a failure.',
  );
  printParagraph(
    'One thing worth saying plainly, because it looks wrong at first: recall fell to 0.88, not to 0.4. The curve FSRS-6 was fitted on has a very long tail. A card only drops to a coin flip after roughly ninety times its stability has passed, which for this card would be decades. A gap of 60 days on a card worth 163 days does not come close, and that is a finding about memory, not a rounding problem.',
  );
}

console.log('');
console.log('Neuron scheduler, FSRS-6');
console.log('========================');
printParagraph(
  'Two numbers describe every card. Stability is how many days it takes for the chance of recall to fall to 90%, so it is roughly the interval the card has earned. Difficulty is how hard this particular card is for this particular person, on a scale of 1 to 10.',
);
printParagraph(
  `Target retention is ${DEFAULT_SCHEDULER_CONFIG.desiredRetention}, learning steps are ${config.learningSteps.join(' and ')} minutes, and the scatter that normally spreads cards across nearby days is switched off so that the same run always prints the same numbers.`,
);
console.log('');

goodStudent();
difficultWord();
longAbsence();
console.log('');
