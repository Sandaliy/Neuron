import { useLayoutEffect, useRef } from 'react';

import { cssDuration } from '../lib/css-duration';
import { motionIsReduced } from '../preferences/motion';

import { Card } from './card';

import type { ReactNode } from 'react';

type ReadingLayout = { top: number; height: number };
const layouts = new WeakMap<Element, ReadingLayout>();
const trails = new WeakMap<
  Element,
  { previous?: string | undefined; current?: string | undefined }
>();
/** Capture the displayed question before blur or the reveal commit changes its layout. */
export function captureLearningReveal(source: HTMLElement) {
  const card =
    source.closest('.neu-learning-card') ??
    source.closest('[data-learning-screen]')?.querySelector('.neu-learning-card');
  const prompt = card?.querySelector('.neu-learning-prompt');
  const surface = card?.querySelector('.neu-learning-surface') ?? card;
  if (card && prompt)
    layouts.set(card, {
      top: prompt.getBoundingClientRect().top,
      height: surface!.getBoundingClientRect().height,
    });
}
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
  const readingRef = useRef<HTMLDivElement>(null);
  /*
   * The reading size follows the length of what is being read. One display
   * size for everything put a two-sentence answer at 36 pixels on a phone, and
   * it scrolled inside the card. Declared before the reveal effect, so the
   * question is measured at the size it is shown at.
   */
  useLayoutEffect(() => {
    const blocks = readingRef.current?.querySelectorAll<HTMLElement>(
      '.neu-learning-prompt, .neu-learning-answer',
    );
    for (const block of blocks ?? []) {
      const length = block.textContent?.trim().length ?? 0;
      const size = length > 100 ? 'longer' : length > 40 ? 'long' : 'short';
      if (block.dataset['length'] !== size) block.dataset['length'] = size;
    }
  });
  /*
   * The next card arrives from the right; Undo brings the previous one back
   * from the left. Only the reading area moves, inside a surface that stays
   * put, so a sitting reads as one card being turned rather than a page being
   * redrawn. Each card mounts its own LearningCard, so what was shown before
   * is remembered on the learning screen, which lives for the whole sitting.
   * Undo is recognised as a return to the card shown just before.
   */
  useLayoutEffect(() => {
    const reading = readingRef.current;
    const screen = reading?.closest('[data-learning-screen]');
    if (!reading || !screen) return;
    const seen = trails.get(screen);
    if (seen?.current === identity) return;
    trails.set(screen, { previous: seen?.current, current: identity });
    if (!seen || motionIsReduced()) return;
    const back = identity !== undefined && identity === seen.previous;
    const styles = getComputedStyle(document.documentElement);
    reading.animate(
      [
        { opacity: 0, transform: `translate3d(${back ? -20 : 20}px, 0, 0)` },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: cssDuration(styles.getPropertyValue('--dur-3'), 240),
        easing: styles.getPropertyValue('--ease-enter').trim() || 'ease-out',
        fill: 'backwards',
      },
    );
  }, [identity]);
  useLayoutEffect(() => {
    const element = promptRef.current;
    const reading = readingRef.current;
    const card = element?.closest<HTMLElement>('.neu-learning-card');
    const surface = card?.querySelector<HTMLElement>('.neu-learning-surface');
    if (!element || !reading || !card || !surface) return;
    if (!revealed) {
      const remember = () => captureLearningReveal(element);
      remember();
      const observer = new ResizeObserver(remember);
      observer.observe(card);
      return () => observer.disconnect();
    }
    const before = layouts.get(card);
    if (!before || motionIsReduced()) return;
    const styles = getComputedStyle(document.documentElement);
    const timing = {
      duration: cssDuration(styles.getPropertyValue('--dur-learning'), 340),
      easing: styles.getPropertyValue('--ease-enter').trim() || 'ease-out',
      fill: 'backwards' as const,
    };
    const animations: Animation[] = [];
    const height = surface.getBoundingClientRect().height;
    if (Math.abs(height - before.height) > 1) {
      // The reading layout settles once. Scale a separate visual surface and
      // bound its content instead of laying out the reading area every frame.
      const radius = getComputedStyle(card).borderRadius;
      const surfaceTiming = { ...timing, easing: styles.getPropertyValue('--ease-inout').trim() };
      animations.push(
        surface.animate(
          [{ transform: `scaleY(${before.height / height})` }, { transform: 'scaleY(1)' }],
          surfaceTiming,
        ),
        card.animate(
          [
            { clipPath: `inset(0 0 ${Math.max(0, height - before.height)}px 0 round ${radius})` },
            { clipPath: `inset(0 round ${radius})` },
          ],
          surfaceTiming,
        ),
      );
    }
    const top = element.getBoundingClientRect().top;
    animations.push(
      element.animate(
        [{ transform: `translateY(${before.top - top}px)` }, { transform: 'translateY(0)' }],
        timing,
      ),
    );
    const start = document.timeline.currentTime;
    if (start !== null) for (const animation of animations) animation.startTime = start;
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [revealed, identity]);
  return (
    <div className="neu-learning-card relative flex min-h-0 flex-1 flex-col gap-16 rounded-24 border border-transparent p-20 break-words">
      <Card className="neu-learning-surface">{null}</Card>
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
    </div>
  );
}
