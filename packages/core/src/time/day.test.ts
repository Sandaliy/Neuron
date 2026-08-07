/**
 * The day boundary, checked where it actually breaks: at the cutoff hour, on
 * the two nights a year the clocks move, and in the timezones whose offset is
 * not a whole number of hours.
 */

import { describe, expect, it } from 'vitest';

import {
  MS_PER_DAY,
  MS_PER_HOUR,
  dayDifference,
  dayIndexOf,
  dayStartOf,
  isSupportedTimeZone,
  weekdayOf,
  zoneOffsetMs,
  type DayBoundary,
} from './day.js';

/** The day index a UTC calendar date has when the cutoff is midnight UTC. */
function utcDayIndex(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

const UTC_MIDNIGHT: DayBoundary = { timezone: 'UTC', dayCutoffHour: 0 };
const MOSCOW: DayBoundary = { timezone: 'Europe/Moscow', dayCutoffHour: 4 };
const NEW_YORK: DayBoundary = { timezone: 'America/New_York', dayCutoffHour: 4 };
const KATHMANDU: DayBoundary = { timezone: 'Asia/Kathmandu', dayCutoffHour: 4 };

describe('the day a moment belongs to', () => {
  it('counts UTC calendar days when the cutoff is midnight UTC', () => {
    expect(dayIndexOf(new Date('2026-08-07T00:00:00Z'), UTC_MIDNIGHT)).toBe(
      utcDayIndex(2026, 8, 7),
    );
    expect(dayIndexOf(new Date('2026-08-07T23:59:59Z'), UTC_MIDNIGHT)).toBe(
      utcDayIndex(2026, 8, 7),
    );
    expect(dayIndexOf(new Date('2026-08-08T00:00:00Z'), UTC_MIDNIGHT)).toBe(
      utcDayIndex(2026, 8, 8),
    );
  });

  it('agrees with the plain UTC date difference over a thousand random pairs', () => {
    const base = Date.UTC(2026, 0, 1);

    for (let step = 0; step < 1000; step += 1) {
      const from = new Date(base + step * 7 * MS_PER_HOUR);
      const to = new Date(base + step * 29 * MS_PER_HOUR + 13 * MS_PER_HOUR);
      const expected =
        utcDayIndex(to.getUTCFullYear(), to.getUTCMonth() + 1, to.getUTCDate()) -
        utcDayIndex(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate());

      expect(dayDifference(from, to, UTC_MIDNIGHT)).toBe(expected);
    }
  });

  it('puts a late night answer in Moscow on the day that just ended', () => {
    // 02:00 on the 8th, Moscow being three hours ahead of UTC all year.
    const lateNight = new Date('2026-08-07T23:00:00Z');
    const nextMorning = new Date('2026-08-08T06:00:00Z');

    expect(dayIndexOf(lateNight, MOSCOW)).toBe(utcDayIndex(2026, 8, 7));
    expect(dayIndexOf(nextMorning, MOSCOW)).toBe(utcDayIndex(2026, 8, 8));
    expect(dayDifference(lateNight, nextMorning, MOSCOW)).toBe(1);
  });

  it('starts a new day at the cutoff hour and not at midnight', () => {
    const justBefore = new Date('2026-08-08T00:59:00Z');
    const justAfter = new Date('2026-08-08T01:01:00Z');

    // 03:59 and 04:01 Moscow time.
    expect(dayDifference(justBefore, justAfter, MOSCOW)).toBe(1);
  });
});

describe('the night the clocks change', () => {
  // In 2026 the United States moves to summer time on 8 March, when 02:00
  // becomes 03:00, and back on 1 November, when 02:00 becomes 01:00.
  it('reads 01:30 on the night of the spring change as the previous day', () => {
    const beforeTheJump = new Date('2026-03-08T06:30:00Z');

    expect(dayIndexOf(beforeTheJump, NEW_YORK)).toBe(utcDayIndex(2026, 3, 7));
  });

  it('reads the morning after the spring change as the new day', () => {
    const morning = new Date('2026-03-08T13:00:00Z');

    expect(dayIndexOf(morning, NEW_YORK)).toBe(utcDayIndex(2026, 3, 8));
  });

  it('counts one day between two noons that are only 23 hours apart', () => {
    const before = new Date('2026-03-07T17:00:00Z');
    const after = new Date('2026-03-08T16:00:00Z');

    expect((after.getTime() - before.getTime()) / MS_PER_HOUR).toBe(23);
    expect(dayDifference(before, after, NEW_YORK)).toBe(1);
  });

  it('counts one day between two noons that are 25 hours apart', () => {
    const before = new Date('2026-10-31T16:00:00Z');
    const after = new Date('2026-11-01T17:00:00Z');

    expect((after.getTime() - before.getTime()) / MS_PER_HOUR).toBe(25);
    expect(dayDifference(before, after, NEW_YORK)).toBe(1);
  });

  it('never skips or repeats a day across either change', () => {
    // Every hour of both transition weeks, walked in order.
    for (const start of ['2026-03-05T00:00:00Z', '2026-10-29T00:00:00Z']) {
      let previous = dayIndexOf(new Date(start), NEW_YORK);

      for (let hour = 1; hour <= 24 * 7; hour += 1) {
        const index = dayIndexOf(new Date(Date.parse(start) + hour * MS_PER_HOUR), NEW_YORK);

        expect(index - previous).toBeGreaterThanOrEqual(0);
        expect(index - previous).toBeLessThanOrEqual(1);
        previous = index;
      }
    }
  });

  it('gives the day that contains the cutoff even when the cutoff hour does not exist', () => {
    // Lord Howe Island moves by half an hour, and with a 02:00 cutoff the hour
    // the day is meant to start at is missing on the night of the change.
    const boundary: DayBoundary = { timezone: 'Australia/Lord_Howe', dayCutoffHour: 2 };
    const start = dayStartOf(utcDayIndex(2026, 10, 4), boundary);

    expect(dayIndexOf(start, boundary)).toBe(utcDayIndex(2026, 10, 4));
  });
});

describe('a timezone that is not a whole number of hours from UTC', () => {
  it('rolls Kathmandu over at 04:00 local, which is 22:15 UTC', () => {
    // Kathmandu is five hours and forty five minutes ahead all year.
    expect(dayIndexOf(new Date('2026-01-01T22:00:00Z'), KATHMANDU)).toBe(utcDayIndex(2026, 1, 1));
    expect(dayIndexOf(new Date('2026-01-01T22:30:00Z'), KATHMANDU)).toBe(utcDayIndex(2026, 1, 2));
  });

  it('reports the offset to the minute', () => {
    expect(zoneOffsetMs('Asia/Kathmandu', new Date('2026-01-01T12:00:00Z'))).toBe(
      5 * MS_PER_HOUR + 45 * 60_000,
    );
    expect(zoneOffsetMs('UTC', new Date('2026-01-01T12:00:00Z'))).toBe(0);
  });

  it('is not confused by the offset it cached a moment earlier', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');

    expect(zoneOffsetMs('America/New_York', winter)).toBe(-5 * MS_PER_HOUR);
    expect(zoneOffsetMs('America/New_York', summer)).toBe(-4 * MS_PER_HOUR);
    expect(zoneOffsetMs('America/New_York', winter)).toBe(-5 * MS_PER_HOUR);
  });
});

describe('the moment a day starts', () => {
  it('lands on a moment that belongs to that day, in every timezone tried', () => {
    for (const boundary of [UTC_MIDNIGHT, MOSCOW, NEW_YORK, KATHMANDU]) {
      for (let day = utcDayIndex(2026, 1, 1); day < utcDayIndex(2027, 1, 1); day += 1) {
        expect(dayIndexOf(dayStartOf(day, boundary), boundary)).toBe(day);
      }
    }
  });

  it('is one day of clock time later than the day before, give or take a change of season', () => {
    const first = dayStartOf(utcDayIndex(2026, 6, 1), MOSCOW);
    const second = dayStartOf(utcDayIndex(2026, 6, 2), MOSCOW);

    expect(second.getTime() - first.getTime()).toBe(MS_PER_DAY);
  });
});

describe('the day of the week', () => {
  it('reads the epoch as a Thursday', () => {
    expect(weekdayOf(0)).toBe(4);
  });

  it('matches what a Date says, for a year of days', () => {
    for (let day = utcDayIndex(2026, 1, 1); day < utcDayIndex(2027, 1, 1); day += 1) {
      expect(weekdayOf(day)).toBe(new Date(day * MS_PER_DAY).getUTCDay());
    }
  });

  it('works before the epoch', () => {
    expect(weekdayOf(-1)).toBe(3);
    expect(weekdayOf(-7)).toBe(4);
  });
});

describe('timezone names', () => {
  it('accepts the ones the platform knows', () => {
    expect(isSupportedTimeZone('Europe/Moscow')).toBe(true);
    expect(isSupportedTimeZone('UTC')).toBe(true);
  });

  it('rejects the ones it does not', () => {
    expect(isSupportedTimeZone('Middle/Earth')).toBe(false);
    expect(isSupportedTimeZone('')).toBe(false);
  });
});
