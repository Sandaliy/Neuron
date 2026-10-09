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
  const layout = useRef({ open, height: 0 });
  const running = useRef<Animation | undefined>(undefined);
  const expanded = useRef(open);
  useLayoutEffect(() => () => running.current?.cancel(), []);
  useLayoutEffect(() => {
    expanded.current = open;
    const element = content.current;
    if (!element) return;
    if (!mounted.current) {
      mounted.current = true;
      element.hidden = !open;
      layout.current = {
        open,
        height: element.firstElementChild?.getBoundingClientRect().height ?? 0,
      };
      return;
    }
    function transition(fromHeight?: number) {
      if (!element) return;
      const height = fromHeight ?? (element.hidden ? 0 : element.getBoundingClientRect().height);
      const opacity = element.hidden ? '0' : getComputedStyle(element).opacity;
      running.current?.cancel();
      running.current = undefined;
      const opening = expanded.current;
      if (motionIsReduced()) {
        element.hidden = !opening;
        return;
      }
      element.hidden = false;
      const target = opening ? (element.firstElementChild?.getBoundingClientRect().height ?? 0) : 0;
      const styles = getComputedStyle(document.documentElement);
      const animation = element.animate(
        [
          { height: `${height}px`, opacity },
          { height: `${target}px`, opacity: opening ? 1 : 0 },
        ],
        {
          duration: cssDuration(styles.getPropertyValue('--dur-3'), 240),
          easing: styles.getPropertyValue('--ease-inout').trim(),
          fill: 'both',
        },
      );
      running.current = animation;
      animation.onfinish = () => {
        element.hidden = !opening;
        running.current = undefined;
        animation.cancel();
      };
    }
    const naturalHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0;
    if (
      open !== layout.current.open ||
      (open && Math.abs(naturalHeight - layout.current.height) > 0.5)
    )
      transition(
        open === layout.current.open && !running.current ? layout.current.height : undefined,
      );
    // Plan/voice responses can change open content after the entrance finishes.
    // Retarget before paint from its previous height, or its in-flight position.
    let contentHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0;
    layout.current = { open, height: contentHeight };
    const observer = new ResizeObserver(() => {
      const nextHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0;
      if (expanded.current && Math.abs(nextHeight - contentHeight) > 0.5)
        transition(running.current ? undefined : contentHeight);
      contentHeight = nextHeight;
      layout.current = { open: expanded.current, height: nextHeight };
    });
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, children]);
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
      <div id={id} ref={content} inert={!open} aria-hidden={!open} className="overflow-hidden">
        <div className="pt-12">{children}</div>
      </div>
    </div>
  );
}
