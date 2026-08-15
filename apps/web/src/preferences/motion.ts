import { useSyncExternalStore } from 'react';

import { STORAGE_KEYS } from '../lib/storage';

import { createDevicePreference } from './device';

/**
 * How much the interface is allowed to move.
 *
 * `system` follows `prefers-reduced-motion`, which the stylesheet answers on
 * its own. `reduce` is the switch in Appearance, and it does exactly what the
 * system request does: every duration collapses to a millisecond, states still
 * change, nothing travels.
 *
 * A device preference, like the theme and the language. It never syncs: a phone
 * and a laptop have different reasons for their answer.
 */
export const MOTION_MODES = ['system', 'reduce'] as const;

export type MotionMode = (typeof MOTION_MODES)[number];

export const DEFAULT_MOTION: MotionMode = 'system';

/** Whether the operating system is asking for less movement right now. */
export function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function apply(mode: MotionMode): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  if (mode === 'reduce') {
    root.dataset['motion'] = 'reduce';
  } else {
    delete root.dataset['motion'];
  }
}

const preference = createDevicePreference<MotionMode>({
  key: STORAGE_KEYS.motion,
  fallback: () => DEFAULT_MOTION,
  parse: (raw) =>
    (MOTION_MODES as readonly string[]).includes(raw) ? (raw as MotionMode) : undefined,
  serialise: (value) => value,
  apply,
});

/** Whether movement is off, whichever way it was asked for. */
export function motionIsReduced(): boolean {
  return preference.get() === 'reduce' || systemPrefersReducedMotion();
}

export function setMotion(mode: MotionMode): void {
  preference.set(mode);
}

export function subscribeMotion(listener: () => void): () => void {
  return preference.subscribe(listener);
}

export interface MotionValue {
  readonly motion: MotionMode;
  /** True when the system asks for less movement, whatever was chosen here. */
  readonly systemReduced: boolean;
  readonly setMotion: (mode: MotionMode) => void;
}

export function useMotion(): MotionValue {
  const motion = useSyncExternalStore(preference.subscribe, preference.get, preference.get);

  return { motion, systemReduced: systemPrefersReducedMotion(), setMotion };
}
