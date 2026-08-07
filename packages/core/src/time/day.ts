/**
 * Where one day ends and the next one begins.
 *
 * FSRS counts in days, so something has to decide which day an answer belongs
 * to. UTC midnight is the wrong answer for almost everybody. Somebody in Moscow
 * answering at 02:00 local is still inside the previous UTC day, so both the
 * same day rule and the elapsed day count misfire for them.
 *
 * A day here runs from a cutoff hour in the user's own timezone to the same
 * hour the next local day. The default cutoff is 04:00: late enough that a
 * session which runs past midnight still counts as one day, early enough that
 * nobody starts their morning inside yesterday. Anki uses the same convention,
 * and the model was fitted on data collected under it.
 *
 * Everything here is built on Intl, which every browser and every supported
 * Node version ships. No date library and no Node built-ins, so the file runs
 * unchanged on the phone and on the server.
 */

/** Milliseconds in one day. */
export const MS_PER_DAY = 86_400_000;

/** Milliseconds in one hour. */
export const MS_PER_HOUR = 3_600_000;

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;

/** Minutes in one day, the point where a step is long enough to be an interval. */
export const MINUTES_PER_DAY = 1440;

/** Days in one week. */
export const DAYS_PER_WEEK = 7;

/** The timezone a user gets before they have told us where they are. */
export const DEFAULT_TIME_ZONE = 'UTC';

/** The hour a day rolls over at, in local time. */
export const DEFAULT_DAY_CUTOFF_HOUR = 4;

/**
 * The two settings that decide which day a moment belongs to. Any object
 * carrying both fields works, which is why the scheduler settings can be
 * passed straight in.
 */
export interface DayBoundary {
  /** An IANA timezone identifier, for example "Europe/Moscow". */
  readonly timezone: string;
  /** The hour a day rolls over at in that timezone, 0 to 23. */
  readonly dayCutoffHour: number;
}

/** 1 January 1970 was a Thursday, which is index 4 with Sunday at 0. */
const EPOCH_WEEKDAY = 4;

/**
 * A formatter for one timezone, and the last offset it was asked for.
 *
 * Building a formatter costs far more than using one, and the simulator asks
 * for millions of day indexes, so both are kept. The cache holds one minute of
 * results per timezone: offsets only ever change on a whole minute, so a
 * result reused inside the same minute is the same result.
 *
 * This is a memo and nothing else. It never changes what a call returns.
 */
interface ZoneCache {
  readonly format: Intl.DateTimeFormat;
  /** Minutes since the epoch that the cached offset was computed for. */
  minute: number;
  /** The cached offset, or NaN when nothing has been cached yet. */
  offsetMs: number;
}

const zoneCaches = new Map<string, ZoneCache>();

/**
 * Builds the formatter for a timezone, or returns the one already built.
 *
 * @param timezone an IANA timezone identifier
 * @returns the cache entry for that timezone
 * @throws RangeError if the platform does not know the timezone
 */
function cacheFor(timezone: string): ZoneCache {
  const existing = zoneCaches.get(timezone);

  if (existing !== undefined) {
    return existing;
  }

  const created: ZoneCache = {
    // hourCycle h23 matters: the h24 cycle reports midnight as hour 24, which
    // would push every midnight into the following day.
    format: new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    minute: Number.NaN,
    offsetMs: Number.NaN,
  };

  zoneCaches.set(timezone, created);

  return created;
}

/**
 * Reads the wall clock in a timezone and returns it as if it were UTC.
 *
 * @param format a formatter already bound to the timezone
 * @param instant the moment to read
 * @returns the local year, month, day and time packed into a UTC timestamp
 */
function localWallClock(format: Intl.DateTimeFormat, instant: Date): number {
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of format.formatToParts(instant)) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        second = Number(part.value);
        break;
      default:
        break;
    }
  }

  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Checks whether the platform knows a timezone.
 *
 * @param timezone the identifier to check
 * @returns true when a formatter can be built for it
 */
export function isSupportedTimeZone(timezone: string): boolean {
  try {
    cacheFor(timezone);

    return true;
  } catch {
    return false;
  }
}

/**
 * How far ahead of UTC a timezone is at a given moment.
 *
 * @param timezone an IANA timezone identifier
 * @param instant the moment to ask about, since the answer changes with the
 *   season in most of the world
 * @returns the offset in milliseconds, positive east of Greenwich
 * @throws RangeError if the platform does not know the timezone
 */
export function zoneOffsetMs(timezone: string, instant: Date): number {
  if (timezone === 'UTC' || timezone === 'Etc/UTC') {
    return 0;
  }

  const cache = cacheFor(timezone);
  const time = instant.getTime();
  const minute = Math.floor(time / MS_PER_MINUTE);

  if (cache.minute === minute) {
    return cache.offsetMs;
  }

  // The wall clock is read to the second, so the instant has to be compared to
  // the second as well or the leftover milliseconds land in the offset.
  const offsetMs =
    localWallClock(cache.format, instant) - Math.floor(time / MS_PER_SECOND) * MS_PER_SECOND;

  cache.minute = minute;
  cache.offsetMs = offsetMs;

  return offsetMs;
}

/**
 * Which study day a moment falls in.
 *
 * The number counts days from 1 January 1970 in the user's own timezone, so it
 * is comparable, subtractable, and stable across a change of location in a way
 * a calendar date is not.
 *
 * @param instant the moment to place
 * @param boundary the timezone and the hour a day rolls over at
 * @returns the day index, which is negative before 1970
 */
export function dayIndexOf(instant: Date, boundary: DayBoundary): number {
  const local = instant.getTime() + zoneOffsetMs(boundary.timezone, instant);

  return Math.floor((local - boundary.dayCutoffHour * MS_PER_HOUR) / MS_PER_DAY);
}

/**
 * The moment a study day starts.
 *
 * Two passes, because the offset being solved for depends on the answer. On
 * the night the clocks go forward the cutoff hour may not exist at all, and
 * then the day starts at the first moment that does exist after it.
 *
 * @param dayIndex the day, as returned by {@link dayIndexOf}
 * @param boundary the timezone and the hour a day rolls over at
 * @returns the moment the day begins
 */
export function dayStartOf(dayIndex: number, boundary: DayBoundary): Date {
  const local = dayIndex * MS_PER_DAY + boundary.dayCutoffHour * MS_PER_HOUR;
  const guess = new Date(local - zoneOffsetMs(boundary.timezone, new Date(local)));

  return new Date(local - zoneOffsetMs(boundary.timezone, guess));
}

/**
 * Whole days between two moments, counted as study days.
 *
 * Two answers inside the same study day are zero days apart no matter how many
 * hours separate them, and answers on consecutive study days are one day apart
 * even if only minutes separate them. The scheduler leans on that: zero
 * elapsed days is what selects the same day formula.
 *
 * @param from the earlier moment
 * @param to the later moment
 * @param boundary the timezone and the hour a day rolls over at
 * @returns the number of day boundaries crossed, negative if `to` is earlier
 */
export function dayDifference(from: Date, to: Date, boundary: DayBoundary): number {
  return dayIndexOf(to, boundary) - dayIndexOf(from, boundary);
}

/**
 * Which day of the week a study day falls on.
 *
 * @param dayIndex the day, as returned by {@link dayIndexOf}
 * @returns 0 for Sunday through 6 for Saturday, matching `Date.getDay`
 */
export function weekdayOf(dayIndex: number): number {
  return (((dayIndex + EPOCH_WEEKDAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}
