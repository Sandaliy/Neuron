import { ChevronDown } from 'lucide-react';
import { useCallback, useId, useLayoutEffect, useRef } from 'react';

import { motionIsReduced } from '../preferences/motion';

import type { ReactNode } from 'react';

/** A labelled disclosure with native reversal and immediate accessible state. */
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
  const inner = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const expanded = useRef(open);
  const endpoint = useRef<number | undefined>(undefined);
  const resize = useCallback((height: number) => {
    const element = content.current;
    if (!element) return;
    const target = expanded.current ? height : 0;
    if (endpoint.current !== undefined && Math.abs(endpoint.current - target) < 0.5) return;
    endpoint.current = target;
    element.dataset['moving'] = String(
      mounted.current &&
        !motionIsReduced() &&
        Math.abs(element.getBoundingClientRect().height - target) > 0.5,
    );
    element.style.height = `${target}px`;
  }, []);
  useLayoutEffect(() => {
    expanded.current = open;
    if (!mounted.current && content.current) content.current.style.transition = 'none';
    resize(inner.current?.getBoundingClientRect().height ?? 0);
    if (!mounted.current && content.current) {
      content.current.getBoundingClientRect();
      content.current.style.removeProperty('transition');
    }
    mounted.current = true;
  }, [open, resize]);
  useLayoutEffect(() => {
    // One observer for the disclosure's lifetime. Native CSS transitions retain
    // the displayed height on reversal; unrelated renders cannot restart them.
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.borderBoxSize[0]?.blockSize;
      if (expanded.current) resize(size ?? inner.current?.offsetHeight ?? 0);
    });
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [resize]);
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
      <div
        id={id}
        ref={content}
        inert={!open}
        aria-hidden={!open}
        data-disclosure-open={open}
        className="neu-disclosure -mx-8 px-8"
        style={{ height: '0px' }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && event.propertyName === 'height')
            event.currentTarget.dataset['moving'] = 'false';
        }}
      >
        <div ref={inner} className="flow-root pt-12 pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}
