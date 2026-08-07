import { describe, expect, it } from 'vitest';

import { MS_PER_DAY, MS_PER_MINUTE } from '../time/day.js';

import { createSchedulerConfig } from './parameters.js';
import { createSeededRandom, type RandomSource } from './random.js';
import { preview, replay, retrievability, review } from './scheduler.js';
import {
  RATING,
  newCard,
  type Rating,
  type ReviewLog,
  type ReviewedCardState,
  type SchedulingState,
} from './types.js';

const config = createSchedulerConfig({ enableFuzz: false });
const noFuzz: RandomSource = () => 0;
const start = new Date(Date.UTC(2026, 5, 1, 9, 0));

/** Answers a card and insists the result is a card with a memory state. */
function answer(
  state: SchedulingState,
  rating: Rating,
  at: Date,
  settings = config,
  rng: RandomSource = noFuzz,
): ReviewedCardState {
  const next = review(state, rating, at, settings, rng).next;

  if (next.state === 'new') {
    throw new Error('A card cannot still be new after being answered.');
  }

  return next;
}

/** Minutes between two moments. */
function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_MINUTE;
}

/** Days between two moments. */
function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

describe('a card seen for the first time', () => {
  it('comes back in one minute on Again', () => {
    const next = answer(newCard(start), RATING.again, start);

    expect(next.state).toBe('learning');
    expect(minutesBetween(start, next.due)).toBe(1);
    expect(next.learningStep).toBe(0);
  });

  it('comes back between the two steps on Hard', () => {
    const next = answer(newCard(start), RATING.hard, start);

    expect(next.state).toBe('learning');
    expect(minutesBetween(start, next.due)).toBe(6);
  });

  it('moves to the second step on Good', () => {
    const next = answer(newCard(start), RATING.good, start);

    expect(next.state).toBe('learning');
    expect(minutesBetween(start, next.due)).toBe(10);
    expect(next.learningStep).toBe(1);
  });

  it('skips the steps entirely on Easy', () => {
    const next = answer(newCard(start), RATING.easy, start);

    expect(next.state).toBe('review');
    expect(daysBetween(start, next.due)).toBe(8);
  });

  it('starts with the stability the weights give that answer', () => {
    expect(answer(newCard(start), RATING.good, start).stability).toBeCloseTo(2.3065, 8);
    expect(answer(newCard(start), RATING.easy, start).stability).toBeCloseTo(8.2956, 8);
  });

  it('counts the review and leaves the lapse count alone', () => {
    const next = answer(newCard(start), RATING.again, start);

    expect(next.reps).toBe(1);
    expect(next.lapses).toBe(0);
  });
});

describe('a card walking its learning steps', () => {
  const onSecondStep = answer(newCard(start), RATING.good, start);
  const tenMinutesLater = new Date(start.getTime() + 10 * MS_PER_MINUTE);

  it('graduates when Good runs out of steps', () => {
    const next = answer(onSecondStep, RATING.good, tenMinutesLater);

    expect(next.state).toBe('review');
    expect(next.learningStep).toBe(0);
    expect(daysBetween(tenMinutesLater, next.due)).toBeGreaterThanOrEqual(1);
  });

  it('graduates immediately on Easy', () => {
    const next = answer(newCard(start), RATING.easy, start);

    expect(next.state).toBe('review');
  });

  it('stays on the same step on Hard', () => {
    const next = answer(onSecondStep, RATING.hard, tenMinutesLater);

    expect(next.state).toBe('learning');
    expect(next.learningStep).toBe(1);
  });

  it('goes back to the first step on Again without counting a lapse', () => {
    const next = answer(onSecondStep, RATING.again, tenMinutesLater);

    expect(next.state).toBe('learning');
    expect(next.learningStep).toBe(0);
    expect(minutesBetween(tenMinutesLater, next.due)).toBe(1);
    expect(next.lapses).toBe(0);
  });
});

describe('a card in the review state', () => {
  const graduated = answer(
    answer(newCard(start), RATING.easy, start),
    RATING.good,
    new Date(start.getTime() + 8 * MS_PER_DAY),
  );
  const dueDay = new Date(graduated.due.getTime());

  it('drops into relearning on Again and counts the lapse', () => {
    const next = answer(graduated, RATING.again, dueDay);

    expect(next.state).toBe('relearning');
    expect(next.lapses).toBe(1);
    expect(minutesBetween(dueDay, next.due)).toBe(10);
  });

  it('loses stability on Again but keeps most of what it had', () => {
    const next = answer(graduated, RATING.again, dueDay);

    expect(next.stability).toBeLessThan(graduated.stability);
    expect(next.stability).toBeGreaterThan(0);
  });

  it('gives longer intervals for better answers', () => {
    const options = preview(graduated, dueDay, config);

    expect(options[RATING.easy].intervalDays).toBeGreaterThanOrEqual(
      options[RATING.good].intervalDays,
    );
    expect(options[RATING.good].intervalDays).toBeGreaterThanOrEqual(
      options[RATING.hard].intervalDays,
    );
  });

  it('never gives Good the same interval as Hard', () => {
    const options = preview(graduated, dueDay, config);

    expect(options[RATING.good].intervalDays).toBeGreaterThan(options[RATING.hard].intervalDays);
    expect(options[RATING.easy].intervalDays).toBeGreaterThan(options[RATING.good].intervalDays);
  });
});

describe('a card in relearning', () => {
  const graduated = answer(
    answer(newCard(start), RATING.easy, start),
    RATING.good,
    new Date(start.getTime() + 8 * MS_PER_DAY),
  );
  const lapsedAt = new Date(graduated.due.getTime());
  const lapsed = answer(graduated, RATING.again, lapsedAt);
  const tenMinutesLater = new Date(lapsedAt.getTime() + 10 * MS_PER_MINUTE);

  it('leaves relearning on Good', () => {
    const next = answer(lapsed, RATING.good, tenMinutesLater);

    expect(next.state).toBe('review');
  });

  it('repeats the step on Hard, at one and a half times its length', () => {
    const next = answer(lapsed, RATING.hard, tenMinutesLater);

    expect(next.state).toBe('relearning');
    expect(minutesBetween(tenMinutesLater, next.due)).toBe(15);
  });

  it('does not count a second lapse for failing again', () => {
    const next = answer(lapsed, RATING.again, tenMinutesLater);

    expect(next.lapses).toBe(1);
  });
});

describe('answering twice on the same day', () => {
  it('uses the same day rule rather than treating no time as no evidence', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    const later = new Date(start.getTime() + 3 * 60 * MS_PER_MINUTE);
    const next = answer(graduated, RATING.good, later);

    expect(next.stability).toBeGreaterThanOrEqual(graduated.stability);
    expect(next.reps).toBe(2);
  });

  it('lowers stability when the second answer is Again', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    const later = new Date(start.getTime() + 3 * 60 * MS_PER_MINUTE);

    expect(answer(graduated, RATING.again, later).stability).toBeLessThan(graduated.stability);
  });
});

describe('settings that change the shape of the schedule', () => {
  it('sends a card straight to the review state when there are no learning steps', () => {
    const settings = createSchedulerConfig({ learningSteps: [], enableFuzz: false });
    const next = answer(newCard(start), RATING.good, start, settings);

    expect(next.state).toBe('review');
    expect(daysBetween(start, next.due)).toBeGreaterThanOrEqual(1);
  });

  it('treats a step of a day or more as an interval, not as a step', () => {
    const settings = createSchedulerConfig({ learningSteps: [1440, 2880], enableFuzz: false });
    const next = answer(newCard(start), RATING.again, start, settings);

    expect(next.state).toBe('review');
    expect(daysBetween(start, next.due)).toBe(1);
  });

  it('holds intervals inside the maximum', () => {
    const settings = createSchedulerConfig({ maximumInterval: 30, enableFuzz: false });
    let state: SchedulingState = newCard(start);
    let at = start;

    for (let index = 0; index < 20; index += 1) {
      state = answer(state, RATING.easy, at, settings);
      at = new Date(state.due.getTime());

      expect(daysBetween(state.lastReview ?? at, state.due)).toBeLessThanOrEqual(32);
    }
  });

  it('shortens intervals when the target retention goes up', () => {
    const relaxed = createSchedulerConfig({ desiredRetention: 0.8, enableFuzz: false });
    const strict = createSchedulerConfig({ desiredRetention: 0.97, enableFuzz: false });
    const at = new Date(start.getTime() + 8 * MS_PER_DAY);
    const seed = answer(newCard(start), RATING.easy, start);

    expect(answer(seed, RATING.good, at, strict).due.getTime()).toBeLessThan(
      answer(seed, RATING.good, at, relaxed).due.getTime(),
    );
  });

  it('refuses a target retention outside the range the model was fitted in', () => {
    expect(() => createSchedulerConfig({ desiredRetention: 0.5 })).toThrow(RangeError);
    expect(() => createSchedulerConfig({ desiredRetention: 0.99 })).toThrow(RangeError);
  });

  it('refuses a step that is not a length of time', () => {
    expect(() => createSchedulerConfig({ learningSteps: [0] })).toThrow(RangeError);
    expect(() => createSchedulerConfig({ relearningSteps: [-5] })).toThrow(RangeError);
  });

  it('refuses a weight vector that is not the right length', () => {
    expect(() => createSchedulerConfig({ parameters: [1, 2, 3] })).toThrow(RangeError);
  });

  it('pulls a weight outside its range back into it', () => {
    const settings = createSchedulerConfig({
      parameters: [...config.parameters.slice(0, 4), 99, ...config.parameters.slice(5)],
    });

    expect(settings.parameters[4]).toBe(10);
  });
});

describe('the review log', () => {
  it('records what the card looked like before the answer', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    const at = new Date(start.getTime() + 8 * MS_PER_DAY);
    const { log } = review(graduated, RATING.good, at, config, noFuzz, 4200);

    expect(log.rating).toBe(RATING.good);
    expect(log.reviewedAt).toBe(at);
    expect(log.stateBefore).toBe('review');
    expect(log.stabilityBefore).toBeCloseTo(graduated.stability, 8);
    expect(log.difficultyBefore).toBeCloseTo(graduated.difficulty, 8);
    expect(log.elapsedDays).toBe(8);
    expect(log.scheduledDays).toBe(8);
    expect(log.durationMs).toBe(4200);
  });

  it('has no memory values on the first review of a card', () => {
    const { log } = review(newCard(start), RATING.good, start, config, noFuzz);

    expect(log.stateBefore).toBe('new');
    expect(log.stabilityBefore).toBeUndefined();
    expect(log.difficultyBefore).toBeUndefined();
    expect(log.elapsedDays).toBe(0);
    expect(log.scheduledDays).toBe(0);
  });

  it('counts no elapsed days for a second answer on the same day', () => {
    const learning = answer(newCard(start), RATING.good, start);
    const later = new Date(start.getTime() + 10 * MS_PER_MINUTE);
    const { log } = review(learning, RATING.good, later, config, noFuzz);

    expect(log.elapsedDays).toBe(0);
    expect(log.scheduledDays).toBe(0);
  });

  it('reads a timestamp behind the last review as another answer on the same day', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    const earlier = new Date(start.getTime() - 3 * MS_PER_DAY);
    const { log } = review(graduated, RATING.good, earlier, config, noFuzz);

    expect(log.elapsedDays).toBe(0);
  });

  it('refuses a review time that is not a date', () => {
    expect(() => review(newCard(start), RATING.good, new Date(Number.NaN), config, noFuzz)).toThrow(
      RangeError,
    );
  });
});

describe('retrievability', () => {
  it('is zero for a card nobody has seen', () => {
    expect(retrievability(newCard(start), start, config)).toBe(0);
  });

  it('is certain on the day of the answer', () => {
    const graduated = answer(newCard(start), RATING.easy, start);

    expect(retrievability(graduated, start, config)).toBe(1);
  });

  it('is about the target on the day the card is due', () => {
    const graduated = answer(newCard(start), RATING.easy, start);

    expect(retrievability(graduated, graduated.due, config)).toBeCloseTo(0.9, 2);
  });

  it('keeps falling the longer a card is left', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    let previous = 1;

    for (const days of [1, 10, 30, 90, 365]) {
      const value = retrievability(
        graduated,
        new Date(start.getTime() + days * MS_PER_DAY),
        config,
      );

      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });
});

describe('preview', () => {
  it('says the same thing the review would do', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    const at = new Date(start.getTime() + 8 * MS_PER_DAY);
    const options = preview(graduated, at, config);

    for (const rating of [RATING.again, RATING.hard, RATING.good, RATING.easy]) {
      expect(options[rating].next).toEqual(answer(graduated, rating, at));
    }
  });

  it('gives fractional days for a card still on its minute steps', () => {
    const options = preview(newCard(start), start, config);

    expect(options[RATING.again].intervalDays).toBeCloseTo(1 / 1440, 10);
    expect(options[RATING.good].intervalDays).toBeCloseTo(10 / 1440, 10);
  });

  it('says the same thing with fuzz on, because a label must not jitter', () => {
    const fuzzy = createSchedulerConfig({ enableFuzz: true });
    const graduated = answer(newCard(start), RATING.easy, start, fuzzy, createSeededRandom(5));
    const at = new Date(graduated.due.getTime());

    expect(preview(graduated, at, fuzzy)).toEqual(preview(graduated, at, config));
  });

  it('leaves the card it was given alone', () => {
    const graduated = answer(newCard(start), RATING.easy, start);
    const before = JSON.stringify(graduated);

    preview(graduated, new Date(start.getTime() + 8 * MS_PER_DAY), config);

    expect(JSON.stringify(graduated)).toBe(before);
  });
});

describe('replay', () => {
  it('returns a new card when there is nothing to replay', () => {
    expect(replay([], config).state).toBe('new');
  });

  it('rebuilds the same card the answers produced', () => {
    const ratings: Rating[] = [
      RATING.good,
      RATING.good,
      RATING.again,
      RATING.good,
      RATING.hard,
      RATING.easy,
      RATING.good,
    ];
    const logs: ReviewLog[] = [];
    let state: SchedulingState = newCard(start);
    let at = start;

    for (const rating of ratings) {
      const result = review(state, rating, at, config, noFuzz);

      logs.push(result.log);
      state = result.next;
      at = new Date(state.due.getTime());
    }

    expect(replay(logs, config)).toEqual(state);
  });

  it('ignores fuzz, so two devices rebuild the same card', () => {
    const fuzzy = createSchedulerConfig({ enableFuzz: true });
    const logs: ReviewLog[] = [];
    let state: SchedulingState = newCard(start);
    let at = start;
    const rng = createSeededRandom(11);

    for (let index = 0; index < 10; index += 1) {
      const result = review(state, RATING.good, at, fuzzy, rng);

      logs.push(result.log);
      state = result.next;
      at = new Date(state.due.getTime());
    }

    const rebuilt = replay(logs, fuzzy);

    expect(rebuilt).toEqual(replay(logs, config));
    expect(rebuilt.state).toBe('review');
  });
});
