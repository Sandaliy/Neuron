import { useEffect, useState } from 'react';

import { cssDuration } from '../lib/css-duration';
import { motionIsReduced } from '../preferences/motion';

/** A quiet completion ring. Draws once on completion; the accessible value is immediately final. */
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
  const [display, setDisplay] = useState(() => (motionIsReduced() ? ratio : 0));
  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const duration = cssDuration(
      getComputedStyle(document.documentElement).getPropertyValue('--dur-completion'),
      900,
    );
    const tick = (now: number) => {
      const progress = motionIsReduced() ? 1 : Math.min(1, (now - started) / duration);
      setDisplay(ratio * (1 - (1 - progress) ** 2));
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
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - display}
          className="text-accent"
        />
      </svg>
      <span className="text-44 text-primary" data-numeric="">
        {Math.round(display * 100)}%
      </span>
    </div>
  );
}
