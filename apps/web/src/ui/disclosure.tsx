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
  reveal = 'continuous',
}: {
  readonly title: ReactNode;
  readonly leading?: ReactNode;
  readonly detail?: ReactNode;
  readonly children: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
  readonly reveal?: 'continuous' | 'progressive';
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
    if (expanded.current && element.style.height === 'auto') return;
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
    const element = content.current;
    if (element?.style.height === 'auto' && !open) {
      element.style.height = `${element.getBoundingClientRect().height}px`;
      element.getBoundingClientRect();
    }
    expanded.current = open;
    if (!mounted.current && content.current) content.current.style.transition = 'none';
    resize(inner.current?.getBoundingClientRect().height ?? 0);
    if (element) {
      if (open && reveal === 'progressive' && element.dataset['moving'] !== 'true')
        element.style.height = 'auto';
    }
    if (!mounted.current && content.current) {
      content.current.getBoundingClientRect();
      content.current.style.removeProperty('transition');
    }
    mounted.current = true;
  }, [open, resize, reveal]);
  useLayoutEffect(() => {
    const element = content.current;
    const body = inner.current;
    if (reveal !== 'progressive' || !element || !body || motionIsReduced()) return;
    // Measure text/control endpoints once. Reveal complete units as space opens,
    // rather than holding every word until the whole form has expanded.
    const top = body.getBoundingClientRect().top;
    const units = Array.from(
      body.querySelectorAll<HTMLElement>('label, input, textarea, select, button, p, summary'),
    )
      .filter((unit) => unit.closest('.neu-disclosure') === element)
      .map((unit) => ({ unit, bottom: unit.getBoundingClientRect().bottom - top }));
    let frame = 0;
    const sample = () => {
      const height = element.getBoundingClientRect().height;
      for (const { unit, bottom } of units) {
        const visibility = height + 0.5 >= bottom ? '' : 'hidden';
        if (unit.style.visibility !== visibility) unit.style.visibility = visibility;
      }
      if (element.dataset['moving'] === 'true') frame = requestAnimationFrame(sample);
      else for (const { unit } of units) unit.style.removeProperty('visibility');
    };
    sample();
    return () => {
      cancelAnimationFrame(frame);
      for (const { unit } of units) unit.style.removeProperty('visibility');
    };
  }, [open, reveal]);
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
          if (event.target === event.currentTarget && event.propertyName === 'height') {
            event.currentTarget.dataset['moving'] = 'false';
            if (expanded.current && reveal === 'progressive')
              event.currentTarget.style.height = 'auto';
          }
        }}
        onTransitionCancel={(event) => {
          if (event.target === event.currentTarget && motionIsReduced()) {
            event.currentTarget.dataset['moving'] = 'false';
            if (expanded.current && reveal === 'progressive')
              event.currentTarget.style.height = 'auto';
          }
        }}
      >
        <div ref={inner} className="neu-disclosure-content flow-root pt-12 pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}
