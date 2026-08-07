/**
 * Invariants. Not "this input gives that output", but "whatever happens, this
 * has to hold". Each one is checked against thousands of generated histories,
 * so a change that breaks the rule in some corner is caught even when nobody
 * thought to write that corner down as a case.
 */

import { describe, expect, it } from 'vitest';

import { MS_PER_DAY, MS_PER_MINUTE } from '../time/day.js';

import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  createSchedulerConfig,
  type SchedulerConfig,
} from './parameters.js';
import { createSeededRandom, type RandomSource } from './random.js';
import { preview, replay, retrievability, review } from './scheduler.js';
import {
  RATING,
  RATINGS,
  newCard,
  type Rating,
  type ReviewLog,
  type SchedulingState,
} from './types.js';

const START = new Date(Date.UTC(2026, 0, 12, 8, 30));
const HISTORY_COUNT = 2000;
const HISTORY_LENGTH = 25;

/** One step of a generated history, with the card as it was on both sides. */
interface WalkStep {
  readonly before: SchedulingState;
  readonly after: SchedulingState;
  readonly rating: Rating;
  readonly at: Date;
  readonly intervalDays: number;
}

/**
 * Answers a card over and over at random, in a way that looks like real use:
 * mostly on the day the card is due, sometimes on the same day, sometimes after
 * an absence.
 */
function walk(
  random: RandomSource,
  config: SchedulerConfig,
  fuzz: RandomSource,
  length = HISTORY_LENGTH,
): WalkStep[] {
  const steps: WalkStep[] = [];
  let state: SchedulingState = newCard(START);
  let at = START;

  for (let index = 0; index < length; index += 1) {
    const rating = RATINGS[Math.floor(random() * RATINGS.length)] ?? RATING.good;
    const result = review(state, rating, at, config, fuzz);

    steps.push({
      before: state,
      after: result.next,
      rating,
      at,
      intervalDays: (result.next.due.getTime() - at.getTime()) / MS_PER_DAY,
    });

    state = result.next;

    const roll = random();

    if (roll < 0.15) {
      at = new Date(at.getTime() + Math.floor(random() * 120) * MS_PER_MINUTE);
    } else if (roll < 0.9) {
      at = new Date(state.due.getTime());
    } else {
      at = new Date(state.due.getTime() + Math.floor(random() * 200) * MS_PER_DAY);
    }
  }

  return steps;
}

/** Runs a check over many generated histories and returns the first failure. */
function overHistories(
  check: (step: WalkStep) => string | null,
  config = createSchedulerConfig({ enableFuzz: false }),
): string | null {
  for (let seed = 0; seed < HISTORY_COUNT; seed += 1) {
    const random = createSeededRandom(seed + 1);

    for (const step of walk(random, config, createSeededRandom(seed + 500))) {
      const failure = check(step);

      if (failure !== null) {
        return `seed ${seed}: ${failure}`;
      }
    }
  }

  return null;
}

describe('what always holds', () => {
  it('keeps stability above zero', () => {
    expect(
      overHistories((step) =>
        step.after.state !== 'new' && step.after.stability > 0
          ? null
          : `stability ${String(step.after.stability)}`,
      ),
    ).toBeNull();
  });

  it('keeps difficulty between one and ten', () => {
    expect(
      overHistories((step) => {
        if (step.after.state === 'new') {
          return 'a card cannot stay new after an answer';
        }

        return step.after.difficulty >= MIN_DIFFICULTY && step.after.difficulty <= MAX_DIFFICULTY
          ? null
          : `difficulty ${step.after.difficulty}`;
      }),
    ).toBeNull();
  });

  it('never lets Again raise stability', () => {
    expect(
      overHistories((step) => {
        if (step.rating !== RATING.again || step.before.state === 'new') {
          return null;
        }

        return step.after.state !== 'new' && step.after.stability <= step.before.stability
          ? null
          : `stability rose from ${step.before.stability} on Again`;
      }),
    ).toBeNull();
  });

  it('sends a review card to relearning on Again and counts the lapse', () => {
    expect(
      overHistories((step) => {
        if (step.rating !== RATING.again || step.before.state !== 'review') {
          return null;
        }

        if (step.after.state !== 'relearning') {
          return `state ${step.after.state} after a lapse`;
        }

        return step.after.lapses === step.before.lapses + 1
          ? null
          : `lapses went ${step.before.lapses} to ${step.after.lapses}`;
      }),
    ).toBeNull();
  });

  it('counts every answer exactly once', () => {
    expect(
      overHistories((step) =>
        step.after.reps === step.before.reps + 1 ? null : `reps ${step.after.reps}`,
      ),
    ).toBeNull();
  });

  it('never schedules a review card sooner than the next day', () => {
    expect(
      overHistories((step) =>
        step.after.state !== 'review' || step.intervalDays >= 1
          ? null
          : `a review card came back in ${step.intervalDays} days`,
      ),
    ).toBeNull();
  });

  it('orders the four buttons, longest interval for the best answer', () => {
    expect(
      overHistories((step) => {
        if (step.before.state !== 'review') {
          return null;
        }

        const options = preview(step.before, step.at, createSchedulerConfig({ enableFuzz: false }));
        const hard = options[RATING.hard].intervalDays;
        const good = options[RATING.good].intervalDays;
        const easy = options[RATING.easy].intervalDays;

        return easy >= good && good >= hard ? null : `hard ${hard}, good ${good}, easy ${easy}`;
      }),
    ).toBeNull();
  });

  it('holds intervals at the maximum, give or take the day that separates the buttons', () => {
    const config = createSchedulerConfig({ maximumInterval: 180, enableFuzz: false });

    expect(
      overHistories(
        (step) =>
          step.intervalDays <= config.maximumInterval + 2
            ? null
            : `interval ${step.intervalDays} past a maximum of ${config.maximumInterval}`,
        config,
      ),
    ).toBeNull();
  });

  it('never fuzzes an interval below one day', () => {
    const config = createSchedulerConfig({ enableFuzz: true });

    expect(
      overHistories(
        (step) => (step.intervalDays > 0 ? null : `interval ${step.intervalDays}`),
        config,
      ),
    ).toBeNull();
  });

  it('gives the same schedule twice for the same seed', () => {
    const config = createSchedulerConfig({ enableFuzz: true });

    for (let seed = 0; seed < 50; seed += 1) {
      const first = walk(createSeededRandom(seed), config, createSeededRandom(seed + 900));
      const second = walk(createSeededRandom(seed), config, createSeededRandom(seed + 900));

      expect(first.map((step) => step.after)).toEqual(second.map((step) => step.after));
    }
  });

  it('gives a different schedule for a different fuzz seed, at least sometimes', () => {
    const config = createSchedulerConfig({ enableFuzz: true });
    const first = walk(createSeededRandom(3), config, createSeededRandom(1));
    const second = walk(createSeededRandom(3), config, createSeededRandom(2));

    expect(first.map((step) => step.after.due.getTime())).not.toEqual(
      second.map((step) => step.after.due.getTime()),
    );
  });

  it('never lets preview touch the card it was given', () => {
    const config = createSchedulerConfig({ enableFuzz: true });

    for (let seed = 0; seed < 100; seed += 1) {
      const random = createSeededRandom(seed + 40);

      for (const step of walk(random, config, createSeededRandom(seed))) {
        const snapshot = JSON.stringify(step.before);

        preview(step.before, step.at, config);

        expect(JSON.stringify(step.before)).toBe(snapshot);
      }
    }
  });

  it('gives the same preview whether fuzz is on or off, so labels hold still', () => {
    const fuzzy = createSchedulerConfig({ enableFuzz: true });
    const plain = createSchedulerConfig({ enableFuzz: false });

    for (let seed = 0; seed < 200; seed += 1) {
      const random = createSeededRandom(seed + 61);

      for (const step of walk(random, fuzzy, createSeededRandom(seed))) {
        expect(preview(step.before, step.at, fuzzy)).toEqual(preview(step.before, step.at, plain));
      }
    }
  });

  it('rebuilds the same card from the log as the answers produced', () => {
    const config = createSchedulerConfig({ enableFuzz: false });

    for (let seed = 0; seed < 300; seed += 1) {
      const random = createSeededRandom(seed + 77);
      const logs: ReviewLog[] = [];
      let state: SchedulingState = newCard(START);
      let at = START;

      for (let index = 0; index < HISTORY_LENGTH; index += 1) {
        const rating = RATINGS[Math.floor(random() * RATINGS.length)] ?? RATING.good;
        const result = review(state, rating, at, config, () => 0);

        logs.push(result.log);
        state = result.next;
        at =
          random() < 0.2
            ? new Date(at.getTime() + Math.floor(random() * 200) * MS_PER_MINUTE)
            : new Date(state.due.getTime());
      }

      expect(replay(logs, config)).toEqual(state);
    }
  });

  it('is certain of a card on the day it was answered and less sure every day after', () => {
    const config = createSchedulerConfig({ enableFuzz: false });

    for (let seed = 0; seed < 200; seed += 1) {
      const steps = walk(createSeededRandom(seed + 12), config, () => 0, 6);
      const last = steps[steps.length - 1];

      if (last === undefined || last.after.state === 'new') {
        continue;
      }

      const answeredAt = last.after.lastReview;

      expect(retrievability(last.after, answeredAt, config)).toBe(1);

      let previous = 1;

      for (const days of [1, 3, 10, 40, 200, 900]) {
        const value = retrievability(
          last.after,
          new Date(answeredAt.getTime() + days * MS_PER_DAY),
          config,
        );

        expect(value).toBeLessThan(previous);
        expect(value).toBeGreaterThan(0);
        previous = value;
      }
    }
  });

  it('is about nine times in ten sure of a card left for exactly its stability', () => {
    const config = createSchedulerConfig({ enableFuzz: false });

    for (let seed = 0; seed < 200; seed += 1) {
      const steps = walk(createSeededRandom(seed + 31), config, () => 0, 8);
      const last = steps[steps.length - 1];

      if (last === undefined || last.after.state === 'new') {
        continue;
      }

      const stability = last.after.stability;
      const at = new Date(last.after.lastReview.getTime() + Math.round(stability) * MS_PER_DAY);

      if (Math.round(stability) < 1) {
        continue;
      }

      expect(retrievability(last.after, at, config)).toBeCloseTo(0.9, 1);
    }
  });
});

/**
 * Answers a card at random and keeps both the log and the card it produced.
 *
 * The moments are drawn the way real use looks: usually on the day the card is
 * due, sometimes twice in one day, sometimes after weeks of silence.
 */
function runHistory(
  seed: number,
  config: SchedulerConfig,
): { logs: ReviewLog[]; state: SchedulingState } {
  const random = createSeededRandom(seed + 4000);
  const fuzz = createSeededRandom(seed + 90_000);
  const logs: ReviewLog[] = [];
  let state: SchedulingState = newCard(START);
  let at = START;

  for (let index = 0; index < 12; index += 1) {
    const rating = RATINGS[Math.floor(random() * RATINGS.length)] ?? RATING.good;
    const result = review(state, rating, at, config, fuzz, Math.floor(random() * 20_000));

    logs.push(result.log);
    state = result.next;

    const roll = random();

    if (roll < 0.2) {
      at = new Date(at.getTime() + Math.floor(random() * 300) * MS_PER_MINUTE);
    } else if (roll < 0.9) {
      at = new Date(state.due.getTime());
    } else {
      at = new Date(state.due.getTime() + Math.floor(random() * 40) * MS_PER_DAY);
    }
  }

  return { logs, state };
}

/** The first field on which a rebuilt card differs from the real one. */
function firstDifference(rebuilt: SchedulingState, actual: SchedulingState): string | null {
  if (rebuilt.state !== actual.state) {
    return `state ${rebuilt.state} against ${actual.state}`;
  }

  if (rebuilt.stability !== actual.stability) {
    return `stability ${String(rebuilt.stability)} against ${String(actual.stability)}`;
  }

  if (rebuilt.difficulty !== actual.difficulty) {
    return `difficulty ${String(rebuilt.difficulty)} against ${String(actual.difficulty)}`;
  }

  if (rebuilt.due.getTime() !== actual.due.getTime()) {
    return `due ${rebuilt.due.toISOString()} against ${actual.due.toISOString()}`;
  }

  if (rebuilt.lastReview?.getTime() !== actual.lastReview?.getTime()) {
    return `last review ${String(rebuilt.lastReview)} against ${String(actual.lastReview)}`;
  }

  if (rebuilt.reps !== actual.reps || rebuilt.lapses !== actual.lapses) {
    return `reps and lapses ${rebuilt.reps}/${rebuilt.lapses} against ${actual.reps}/${actual.lapses}`;
  }

  return rebuilt.learningStep === actual.learningStep
    ? null
    : `learning step ${rebuilt.learningStep} against ${actual.learningStep}`;
}

describe('rebuilding a card from its log when fuzz moved it', () => {
  it('reproduces state, stability, difficulty and the due date over 5000 histories', async ({
    annotate,
  }) => {
    const fuzzy = createSchedulerConfig({ enableFuzz: true });
    const plain = createSchedulerConfig({ enableFuzz: false });
    const failures: string[] = [];
    let historiesFuzzMoved = 0;

    for (let seed = 0; seed < 5000; seed += 1) {
      const scattered = runHistory(seed, fuzzy);
      const difference = firstDifference(replay(scattered.logs, fuzzy), scattered.state);

      if (difference !== null) {
        failures.push(`seed ${seed}: ${difference}`);
        break;
      }

      // Without fuzz the same answers would have landed on other days. If they
      // never did, this test would be proving nothing.
      if (runHistory(seed, plain).state.due.getTime() !== scattered.state.due.getTime()) {
        historiesFuzzMoved += 1;
      }
    }

    await annotate(
      `5000 histories rebuilt from their logs, fuzz had moved the card in ${historiesFuzzMoved} of them`,
    );

    expect(failures).toEqual([]);
    expect(historiesFuzzMoved).toBeGreaterThan(1000);
  });

  it('agrees with the other device about the day, not only about the memory', () => {
    // The bug this guards against: a phone applies fuzz and files the card on
    // Tuesday, a laptop rebuilds the same card from the same log and files it
    // on Monday. Both are self consistent, and they stay a day apart forever.
    const config = createSchedulerConfig({ enableFuzz: true });
    const phone = runHistory(17, config);
    const laptop = replay(phone.logs, config);

    expect(laptop.due.getTime()).toBe(phone.state.due.getTime());
    expect(laptop.state).toBe(phone.state.state);
    expect(laptop.stability).toBe(phone.state.stability);
    expect(laptop.difficulty).toBe(phone.state.difficulty);
  });
});

describe('the maximum interval at the point the buttons collide', () => {
  it('separates Good and Easy by a day each once every button is at the cap', () => {
    const config = createSchedulerConfig({ maximumInterval: 365, enableFuzz: false });
    const settled: SchedulingState = {
      state: 'review',
      stability: 20_000,
      difficulty: 3,
      lastReview: START,
      due: new Date(START.getTime() + 365 * MS_PER_DAY),
      reps: 30,
      lapses: 0,
      learningStep: 0,
    };
    const options = preview(settled, new Date(START.getTime() + 365 * MS_PER_DAY), config);

    expect(options[RATING.hard].intervalDays).toBe(365);
    expect(options[RATING.good].intervalDays).toBe(366);
    expect(options[RATING.easy].intervalDays).toBe(367);
  });
});
