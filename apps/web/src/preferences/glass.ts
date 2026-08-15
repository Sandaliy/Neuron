import { useSyncExternalStore } from 'react';

import { STORAGE_KEYS } from '../lib/storage';

import { createDevicePreference } from './device';
import { systemPrefersReducedMotion } from './motion';

/**
 * How much glass the floating layers carry.
 *
 * Three levels. `full` is 34 pixels of blur at a tint of 0.78, `subtle` is 14
 * at 0.90 for phones that stutter, and `off` is the same surfaces with no blur
 * at all, which is also what a browser without `backdrop-filter` already gets.
 * Off is not a failure state.
 *
 * A device preference, applied before React exists and never synced to the
 * account: a phone and a laptop have different reasons for their answer, and
 * the one thing this setting exists for is a phone that cannot keep up.
 *
 * The level actually painted is the chosen one capped by what the device can
 * afford. A blurred layer costs once per frame it covers, and a phone that
 * stutters is not a phone anybody can detect from a user agent string, so three
 * signals lower the ceiling on their own:
 *
 *   - the system asks for reduced motion,
 *   - the device reports four gigabytes of memory or less,
 *   - a measured frame rate during a scroll falls under the budget.
 *
 * The first two are read once at startup. The third arrives while the app is
 * running and steps the ceiling down one level at a time.
 */
export const GLASS_LEVELS = ['off', 'subtle', 'full'] as const;

export type GlassLevel = (typeof GLASS_LEVELS)[number];

/** What the mockup recommends, and what a device with no complaints gets. */
export const DEFAULT_GLASS: GlassLevel = 'full';

/** Why the level on screen is below the one that was chosen. */
export type GlassCapReason = 'motion' | 'memory' | 'frames';

const RANK: Record<GlassLevel, number> = { off: 0, subtle: 1, full: 2 };

function cheaper(level: GlassLevel): GlassLevel {
  return level === 'full' ? 'subtle' : 'off';
}

/**
 * How much memory the device admits to, in gigabytes.
 *
 * Chromium only, and rounded down to a power of two, which is all this needs:
 * the question is whether the device is at the bottom of the range, not how
 * much memory it has.
 */
function reportedMemory(): number | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return typeof value === 'number' ? value : undefined;
}

function initialCap(): { level: GlassLevel; reason?: GlassCapReason } {
  if (systemPrefersReducedMotion()) {
    return { level: 'subtle', reason: 'motion' };
  }

  const memory = reportedMemory();

  if (memory !== undefined && memory <= 4) {
    return { level: 'subtle', reason: 'memory' };
  }

  return { level: 'full' };
}

let cap = initialCap();

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

/*
 * Takes the chosen level rather than reading it back, because this runs once
 * while the preference itself is still being constructed.
 */
function paintWith(chosen: GlassLevel): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  root.dataset['glass'] = RANK[chosen] <= RANK[cap.level] ? chosen : cap.level;
  root.dataset['glassChoice'] = chosen;
}

function paint(): void {
  paintWith(preference.get());
}

const preference = createDevicePreference<GlassLevel>({
  key: STORAGE_KEYS.glass,
  fallback: () => DEFAULT_GLASS,
  parse: (raw) =>
    (GLASS_LEVELS as readonly string[]).includes(raw) ? (raw as GlassLevel) : undefined,
  serialise: (value) => value,
  apply: paintWith,
});

/** What is painted: the chosen level, capped by what the device can afford. */
export function effectiveGlass(): GlassLevel {
  const chosen = preference.get();

  return RANK[chosen] <= RANK[cap.level] ? chosen : cap.level;
}

/** Why the painted level is below the chosen one, when it is. */
export function glassCapReason(): GlassCapReason | undefined {
  return RANK[preference.get()] > RANK[cap.level] ? cap.reason : undefined;
}

/**
 * Lowers the ceiling one level, because the frames said so.
 *
 * Session scoped on purpose. A single bad scroll on a phone that was busy doing
 * something else should not leave the interface permanently plainer, and the
 * next load measures again.
 */
export function dropGlassForFrames(): void {
  const next = cheaper(cap.level);

  if (RANK[next] >= RANK[cap.level]) {
    return;
  }

  cap = { level: next, reason: 'frames' };
  paint();
  announce();
}

export function setGlass(level: GlassLevel): void {
  preference.set(level);
  announce();
}

function subscribe(listener: () => void): () => void {
  const drop = preference.subscribe(listener);

  listeners.add(listener);

  return () => {
    drop();
    listeners.delete(listener);
  };
}

export interface GlassValue {
  /** What this device chose. */
  readonly glass: GlassLevel;
  /** What is on screen, which is lower when the device cannot afford it. */
  readonly effective: GlassLevel;
  /** Set when the two differ. */
  readonly capReason: GlassCapReason | undefined;
  readonly setGlass: (level: GlassLevel) => void;
}

export function useGlass(): GlassValue {
  const glass = useSyncExternalStore(subscribe, preference.get, preference.get);
  const effective = useSyncExternalStore(subscribe, effectiveGlass, () => DEFAULT_GLASS);
  const capReason = useSyncExternalStore(subscribe, glassCapReason, () => undefined);

  return { glass, effective, capReason, setGlass };
}
