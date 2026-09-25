import { useLayoutEffect, useRef } from 'react';

import { cssDuration } from '../lib/css-duration';
import { motionIsReduced } from '../preferences/motion';

import { Card } from './card';

import type { ReactNode } from 'react';

/** A reading surface shared by scheduled study and independent Practice. */
export function LearningCard({
  context,
  prompt,
  answer,
  identity,
  response,
}: {
  readonly response?: ReactNode;
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
    let animation: Animation | undefined;
    if (
      revealed &&
      before &&
      before.identity === identity &&
      !motionIsReduced() &&
      element.animate
    ) {
      animation = element.animate(
        [{ transform: `translateY(${before.top - top}px)` }, { transform: 'translateY(0)' }],
        {
          duration: cssDuration(
            getComputedStyle(document.documentElement).getPropertyValue('--dur-learning'),
            340,
          ),
          easing:
            getComputedStyle(document.documentElement).getPropertyValue('--ease-enter').trim() ||
            'ease-out',
        },
      );
    }
    previous.current = { identity, top };
    return () => animation?.cancel();
  }, [revealed, identity]);
  return (
    <Card className="neu-learning-card flex min-h-0 flex-1 flex-col gap-16 break-words">
      <div className="text-12 text-secondary">{context}</div>
      <div
        key={identity}
        className="neu-learning-reading relative grid min-h-0 flex-1 grid-rows-2 overflow-y-auto py-16"
      >
        <div className={`flex flex-col justify-center text-primary ${answer ? '' : 'row-span-2'}`}>
          <div ref={promptRef} className="neu-learning-prompt">
            {prompt}
          </div>
        </div>
        {answer && (
          <div className="relative pt-24 text-primary">
            <div
              aria-hidden="true"
              className="neu-answer-divider absolute inset-x-0 top-0 h-px bg-strong"
            />
            <div className="neu-learning-answer">{answer}</div>
          </div>
        )}
      </div>
      {response}
    </Card>
  );
}
