import { dropGlassForFrames, effectiveGlass } from './glass';

/**
 * Watching the frames during a scroll, and lowering the glass if they are bad.
 *
 * The budget is 55 frames a second. A blurred layer costs once per frame it
 * covers, and the one device that pays for it is the one nobody can identify
 * from a user agent string, so the app measures instead of guessing.
 *
 * Only scrolls are sampled. A frame rate measured while nothing moves says
 * nothing, and the one case this exists for is a long list under a blurred bar.
 *
 * Two bad windows are needed, not one. The first scroll of a session competes
 * with whatever else the phone was doing, and dropping the interface a level
 * because of that would be a worse mistake than a few dropped frames.
 */
export const FRAME_BUDGET_FPS = 55;

/** How many frames make a window. About half a second of scrolling. */
const WINDOW_FRAMES = 30;

/** Bad windows needed before the level comes down. */
const STRIKES = 2;

/** How many times a session may step down. Two levels, so two steps. */
const MAX_DROPS = 2;

export interface FrameWatchOptions {
  readonly budget?: number;
  readonly onDrop?: (fps: number) => void;
}

/**
 * Starts watching.
 *
 * @param options budget in frames a second, and what to do about a drop
 * @returns a function that stops watching
 */
export function watchFrameRate(options: FrameWatchOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return () => {};
  }

  const budget = options.budget ?? FRAME_BUDGET_FPS;

  let strikes = 0;
  let drops = 0;
  let frame = 0;
  let frames = 0;
  let started = 0;
  let sampling = false;

  const stopSampling = () => {
    sampling = false;

    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const step = (now: number) => {
    frames += 1;

    if (frames < WINDOW_FRAMES) {
      frame = window.requestAnimationFrame(step);

      return;
    }

    const elapsed = now - started;
    const fps = elapsed > 0 ? (frames / elapsed) * 1000 : budget;

    stopSampling();

    if (fps >= budget) {
      strikes = 0;

      return;
    }

    strikes += 1;

    if (strikes < STRIKES) {
      return;
    }

    strikes = 0;
    drops += 1;
    dropGlassForFrames();
    options.onDrop?.(fps);
  };

  const onScroll = () => {
    if (sampling || drops >= MAX_DROPS || effectiveGlass() === 'off') {
      return;
    }

    sampling = true;
    frames = 0;
    frame = window.requestAnimationFrame((now) => {
      // The first callback only marks the start. Measuring from the scroll
      // event itself would count the browser's own dispatch as a slow frame.
      started = now;
      frame = window.requestAnimationFrame(step);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  return () => {
    stopSampling();
    window.removeEventListener('scroll', onScroll, { capture: true });
  };
}
