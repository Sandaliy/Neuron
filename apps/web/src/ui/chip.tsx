import type { ReactNode } from 'react';

/**
 * A count, in a capsule.
 *
 * Four tones and no others: what is due, what is new, what is slipping, and
 * what is merely scheduled. One accent, one signal hue, and two that are just
 * text. A fifth colour would mean the palette is carrying meaning nobody wrote
 * down.
 *
 * Always mono and always tabular, so a count going from 9 to 10 does not move
 * the row it sits in.
 */
export type ChipTone = 'due' | 'new' | 'slipping' | 'plain';

const TONES: Record<ChipTone, string> = {
  due: 'bg-fill-accent-quiet text-accent',
  new: 'bg-fill-neutral text-secondary',
  slipping: 'bg-fill-error-quiet text-error',
  plain: 'text-tertiary',
};

export function Chip({
  tone = 'plain',
  children,
}: {
  readonly tone?: ChipTone;
  readonly children: ReactNode;
}) {
  return (
    <span
      data-numeric=""
      className={`inline-flex shrink-0 items-center rounded-full px-8 py-4 text-12 leading-tight ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
