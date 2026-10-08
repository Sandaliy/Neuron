import { ChevronDown } from 'lucide-react';
import { useId, useLayoutEffect, useRef } from 'react';

import { cssDuration } from '../lib/css-duration';
import { motionIsReduced } from '../preferences/motion';

import type { ReactNode } from 'react';

/** A labelled disclosure with interruptible motion and immediate accessible state. */
export function Disclosure({
  title,
  leading,
  detail,
  children,
  open,
  onOpenChange,
  className = '',
}: {
  readonly title: ReactNode;
  readonly leading?: ReactNode;
  readonly detail?: ReactNode;
  readonly children: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
}) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const running = useRef<Animation | undefined>(undefined);
  useLayoutEffect(() => () => running.current?.cancel(), []);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    if (!mounted.current) {
      mounted.current = true;
      element.hidden = !open;
      return;
    }
    const interrupted = running.current && !element.hidden ? getComputedStyle(element) : undefined;
    const opacity = interrupted?.opacity;
    const transform = interrupted?.transform;
    running.current?.cancel();
    running.current = undefined;
    if (motionIsReduced()) {
      element.hidden = !open;
      return;
    }
    if (open) element.hidden = false;
    const styles = getComputedStyle(document.documentElement);
    const animation = element.animate(
      open
        ? [
            { opacity: opacity ?? 0, transform: transform ?? 'translateY(-4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ]
        : [
            { opacity: opacity ?? 1, transform: transform ?? 'none' },
            { opacity: 0, transform: transform ?? 'none' },
          ],
      {
        duration: cssDuration(styles.getPropertyValue(open ? '--dur-2' : '--dur-1'), 160),
        easing: styles.getPropertyValue('--ease-enter').trim(),
      },
    );
    running.current = animation;
    animation.onfinish = () => {
      element.hidden = !open;
      running.current = undefined;
    };
  }, [open]);
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <button
        type="button"
        data-tone="text"
        aria-expanded={open}
        aria-label={typeof title === 'string' ? title : undefined}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-44 w-full items-center gap-12 rounded-8 text-left text-14 text-primary hover:text-accent"
      >
        {leading}
        <span className="min-w-0 flex-1 font-semibold">{title}</span>
        {detail}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-secondary transition-transform dur-reveal ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={id} ref={content} inert={!open} aria-hidden={!open}>
        <div className="pt-12">{children}</div>
      </div>
    </div>
  );
}
