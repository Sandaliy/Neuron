import { useLayoutEffect, useRef } from 'react';

import { motionIsReduced } from '../preferences/motion';

import { Card } from './card';

import type { ReactNode } from 'react';

/** A reading surface shared by scheduled study and independent Practice. */
export function LearningCard({
  context,
  prompt,
  answer,
  identity,
}: {
  readonly context: ReactNode;
  readonly prompt: ReactNode;
  readonly answer?: ReactNode;
  readonly identity?: string;
}) {
  const revealed = Boolean(answer);
  const promptRef = useRef<HTMLDivElement>(null);
  const previous = useRef<{ identity: string | undefined; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    const top = element.offsetTop;
    const before = previous.current;
    if (
      revealed &&
      before &&
      before.identity === identity &&
      !motionIsReduced() &&
      element.animate
    ) {
      element.animate(
        [{ transform: `translateY(${before.top - top}px)` }, { transform: 'translateY(0)' }],
        {
          duration:
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-2')) ||
            160,
          easing: 'ease-out',
        },
      );
    }
    previous.current = { identity, top };
  }, [revealed, identity]);
  return (
    <Card className="flex h-[clamp(280px,40svh,420px)] shrink-0 flex-col gap-16 overflow-y-auto break-words">
      <div className="text-12 text-secondary">{context}</div>
      <div key={identity} className="relative grid flex-1 grid-rows-2 py-16">
        <div
          className={`flex flex-col justify-center font-display text-32 leading-body tracking-tight text-primary ${answer ? '' : 'row-span-2'}`}
        >
          <div ref={promptRef}>{prompt}</div>
        </div>
        {answer && (
          <div className="relative pt-24 text-24 leading-body text-primary">
            <div
              aria-hidden="true"
              className="neu-answer-divider absolute inset-x-0 top-0 h-px bg-subtle"
            />
            <div className="neu-reveal">{answer}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
