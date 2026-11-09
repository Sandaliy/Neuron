import { useLayoutEffect, useRef } from 'react';

import { cssDuration } from '../lib/css-duration';
import { motionIsReduced } from '../preferences/motion';

/**
 * A css cubic-bezier as a function of time, so the count follows the same
 * curve the motion tokens name. Newton's method on x, then y at that point.
 */
export function cubicBezier(curve: string): (progress: number) => number {
  const points = /cubic-bezier\(([^)]+)\)/.exec(curve)?.[1]?.split(',').map(Number);
  const [x1, y1, x2, y2] =
    points?.length === 4 && points.every(Number.isFinite) ? points : [0.5, 0, 0.2, 1];
  const axis = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  const slope = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t ** 2;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let step = 0; step < 8; step++) {
      const error = axis(x1!, x2!, t) - progress;
      const derivative = slope(x1!, x2!, t);
      if (Math.abs(error) < 1e-5 || derivative === 0) break;
      t = Math.min(1, Math.max(0, t - error / derivative));
    }
    return axis(y1!, y2!, t);
  };
}

/**
 * A quiet completion ring. The accessible value is final at once.
 *
 * The ring and the number advance together, frame by frame, straight in the
 * DOM. They used to be React state set on every frame, over 340 ms that began
 * while the panel holding them was still fading in: most of the count happened
 * under the fade, the visible part jumped by several percent a frame, and a
 * phone on a 30 Hz power budget showed a handful of numbers and a snap. Now the
 * count waits for the panel's own entrance, runs for `--dur-completion`, and
 * only writes a number when the whole percent changes.
 */
export function CompletionProgress({
  value,
  max,
  label,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}) {
  const ratio = Math.min(1, Math.max(0, value / Math.max(1, max)));
  const ring = useRef<SVGCircleElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  // Where the drawing is now, so a changed value continues from it.
  const shown = useRef(motionIsReduced() ? ratio : 0);

  // Layout, not passive: the starting value is drawn before the first paint.
  useLayoutEffect(() => {
    const paint = (fraction: number) => {
      ring.current?.setAttribute('stroke-dashoffset', String(1 - fraction));
      const text = `${Math.round(fraction * 100)}%`;
      if (number.current && number.current.textContent !== text) number.current.textContent = text;
    };
    const from = shown.current;
    if (motionIsReduced() || from === ratio) {
      shown.current = ratio;
      paint(ratio);
      return;
    }
    const styles = getComputedStyle(document.documentElement);
    const duration = cssDuration(styles.getPropertyValue('--dur-completion'), 720);
    // The first value waits for the entrance it arrives with; a later change does not.
    const delay = from === 0 ? cssDuration(styles.getPropertyValue('--dur-2'), 160) : 0;
    const settle = cubicBezier(styles.getPropertyValue('--ease-inout'));
    let frame = 0;
    let started: number | undefined;
    paint(from);
    const tick = (now: number) => {
      started ??= now + delay;
      const progress = Math.min(1, Math.max(0, (now - started) / duration));
      shown.current = from + (ratio - from) * settle(progress);
      paint(shown.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ratio]);

  return (
    <div
      className="relative flex size-[160px] items-center justify-center"
      role="img"
      aria-label={`${label}: ${Math.round(ratio * 100)}%`}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-secondary opacity-20"
        />
        <circle
          ref={ring}
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          pathLength="1"
          strokeLinecap="round"
          strokeDasharray="1"
          className="text-accent"
        />
      </svg>
      {/* Written by the effect only, so React never holds a stale text node. */}
      <span ref={number} aria-hidden="true" className="text-44 text-primary" data-numeric="" />
    </div>
  );
}
