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
  answerFocused = false,
}: {
  readonly answerFocused?: boolean;
  readonly response?: ReactNode;
  readonly context: ReactNode;
  readonly prompt: ReactNode;
  readonly answer?: ReactNode;
  readonly identity?: string;
}) {
  const revealed = Boolean(answer);
  const promptRef = useRef<HTMLDivElement>(null);
  const previous = useRef<{ identity: string | undefined; top: number } | undefined>(undefined);
  const readingRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    const before = previous.current;
    let animation: Animation | undefined;
    let frame = 0;
    let visualTop = before?.top ?? top;
    let layoutTop = top;
    function move(from: number) {
      if (!element || motionIsReduced()) return;
      animation?.cancel();
      const target = element.getBoundingClientRect().top;
      layoutTop = target;
      animation = element.animate(
        [{ transform: `translateY(${from - target}px)` }, { transform: 'translateY(0)' }],
        {
          duration: cssDuration(
            getComputedStyle(document.documentElement).getPropertyValue('--dur-learning'),
            340,
          ),
          easing:
            getComputedStyle(document.documentElement).getPropertyValue('--ease-enter').trim() ||
            'ease-out',
          fill: 'backwards',
        },
      );
      const sample = () => {
        visualTop = element.getBoundingClientRect().top;
        previous.current = { identity, top: visualTop };
        if (animation?.playState === 'running') frame = requestAnimationFrame(sample);
      };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sample);
    }
    if (revealed && before?.identity === identity && !motionIsReduced()) {
      move(visualTop);
    }
    previous.current = { identity, top: revealed ? visualTop : top };
    if (!revealed) {
      // Focus can reposition a flex child without resizing the observed reading
      // surface. Remember its displayed position while the question is active.
      const remember = () => {
        previous.current = { identity, top: element.getBoundingClientRect().top };
        frame = requestAnimationFrame(remember);
      };
      frame = requestAnimationFrame(remember);
    }
    // Entering the application-owned keyboard-ready composition can move the
    // prompt without a React render here. Reveal starts at its current position.
    const observer = new ResizeObserver(() => {
      const transform = getComputedStyle(element).transform;
      const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
      if (revealed && Math.abs(element.getBoundingClientRect().top - offset - layoutTop) > 0.5)
        move(visualTop);
      else if (!revealed) previous.current = { identity, top: element.getBoundingClientRect().top };
    });
    if (readingRef.current) observer.observe(readingRef.current);
    return () => {
      observer?.disconnect();
      animation?.cancel();
      cancelAnimationFrame(frame);
    };
  });
  return (
    <Card className="neu-learning-card flex min-h-0 flex-1 flex-col gap-16 break-words">
      <div className="text-12 text-secondary">{context}</div>
      <div
        ref={readingRef}
        key={identity}
        className={`neu-learning-reading relative min-h-0 flex-1 overflow-y-auto py-16 ${answerFocused && revealed ? 'flex flex-col' : 'grid grid-rows-2'}`}
      >
        <div
          className={`flex flex-col text-primary ${answerFocused && revealed ? 'my-auto' : 'justify-center'} ${answer ? '' : 'row-span-2'}`}
        >
          <div ref={promptRef} className="neu-learning-prompt">
            {answerFocused && revealed ? (
              <div className="neu-answer-focused">{answer}</div>
            ) : (
              prompt
            )}
          </div>
        </div>
        {answer && !answerFocused && (
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
