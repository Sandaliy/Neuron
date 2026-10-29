import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { cssDuration } from '../lib/css-duration';
import { motionIsReduced } from '../preferences/motion';

import type { ReactNode } from 'react';

/**
 * A labelled disclosure: a header row and a body that opens beneath it.
 *
 * The body grows on `grid-template-rows`, from `0fr` to `1fr`, and its content
 * fades in a beat behind the growth. The browser does all of it. The earlier
 * version measured heights and sampled the layout every frame to reveal its
 * content line by line, which forced a synchronous layout per frame on top of
 * the one the growth already costs, and on a phone that is what stuttered.
 *
 * Every inline disclosure in the product is this one, so Study setup, Offline
 * & sync and the Note editor open with the same speed and the same curve.
 * Reversing mid-way is native: a transition retargets from where it is.
 *
 * `data-moving` is true while the body is changing size, so a test or a nested
 * measurement can wait for it to settle. Once open and settled, the body stops
 * clipping, so focus rings and menus inside it are not cut off.
 */
export function Disclosure({
  title,
  leading,
  detail,
  children,
  open: controlled,
  onOpenChange,
  defaultOpen = false,
  quiet = false,
  className = '',
}: {
  readonly title: ReactNode;
  readonly leading?: ReactNode;
  readonly detail?: ReactNode;
  readonly children: ReactNode;
  /** Controlled when given; otherwise the disclosure keeps its own state. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly defaultOpen?: boolean;
  /** A secondary section: regular weight and the quieter text tone. */
  readonly quiet?: boolean;
  readonly className?: string;
  /** Kept for existing call sites. Every disclosure now reveals the same way. */
  readonly reveal?: 'continuous' | 'progressive';
}) {
  const id = useId();
  const clip = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const [moving, setMoving] = useState(false);
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const settled = useRef({ open, moving });
  useEffect(() => {
    settled.current = { open, moving };
  });

  /*
   * An open body whose content changes size, a language change that adds a
   * row to Study setup say, moves to its new height on the same timing
   * instead of jumping. The browser interpolates; the observer only reads the
   * size it is handed.
   */
  useEffect(() => {
    const frame = clip.current;
    const inner = content.current;
    if (!frame || !inner) return;
    let last = inner.offsetHeight;
    let running: Animation | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.borderBoxSize[0]?.blockSize ?? inner.offsetHeight;
      const previous = last;
      last = next;
      if (!settled.current.open || settled.current.moving || motionIsReduced()) return;
      if (Math.abs(next - previous) < 1) return;
      // A section opening inside this one animates itself; this body follows it.
      if (inner.querySelector('.neu-disclosure[data-moving="true"]')) return;
      const from = running ? frame.getBoundingClientRect().height : previous;
      running?.cancel();
      const styles = getComputedStyle(document.documentElement);
      frame.style.overflow = 'hidden';
      running = frame.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration: cssDuration(styles.getPropertyValue('--dur-3'), 240),
        easing: styles.getPropertyValue('--ease-inout').trim() || 'ease-in-out',
      });
      const own = running;
      own.onfinish = own.oncancel = () => {
        if (running !== own) return;
        running = undefined;
        frame.style.removeProperty('overflow');
      };
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      running?.cancel();
    };
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setMoving(true);
    // A transition that never runs (a hidden tab, a collapsed ancestor) sends
    // no end event, so the settled state cannot depend on one arriving.
    const fallback = setTimeout(() => setMoving(false), 600);
    return () => clearTimeout(fallback);
  }, [open]);

  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <button
        type="button"
        data-tone="text"
        aria-expanded={open}
        aria-label={typeof title === 'string' ? title : undefined}
        aria-controls={id}
        onClick={() => {
          // Moving from the press itself, not a frame later, so nothing can
          // read the body as settled while it is starting to change.
          setMoving(true);
          if (controlled === undefined) setOwn(!open);
          onOpenChange?.(!open);
        }}
        className={[
          'flex min-h-44 w-full items-center gap-12 rounded-8 text-left hover:text-accent',
          quiet ? 'text-13 text-secondary' : 'text-14 text-primary',
        ].join(' ')}
      >
        {leading}
        <span className={quiet ? 'min-w-0 flex-1' : 'min-w-0 flex-1 font-semibold'}>{title}</span>
        {detail}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-secondary transition-transform dur-screen ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        id={id}
        inert={!open}
        aria-hidden={!open}
        data-disclosure-open={open}
        data-moving={moving}
        className="neu-disclosure -mx-8"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setMoving(false);
        }}
      >
        <div ref={clip} className="neu-disclosure-clip px-8">
          <div ref={content} className="neu-disclosure-content flow-root pt-12 pb-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A body that opens and closes in place without a header of its own, such as
 * the children under a Library Folder.
 *
 * It moves exactly as a disclosure does, on the same styles: the space grows
 * on its grid track while the content fades in behind it, and closing is the
 * same in reverse. The rows below slide instead of jumping. The body mounts
 * the first time it opens and unmounts once it has closed, so a collapsed
 * Folder holds no rows and no drop targets.
 */
export function Fold({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const [moving, setMoving] = useState(false);
  if (open && !mounted) setMounted(true);
  if (!open && shown) {
    setShown(false);
    setMoving(true);
  } else if (!open && mounted && !moving) {
    // Closed again before it had begun to open: nothing to animate.
    setMounted(false);
  }

  useEffect(() => {
    if (!open || shown) return;
    // One frame closed first, so the growth has somewhere to start from.
    const frame = requestAnimationFrame(() => {
      setShown(true);
      setMoving(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, shown]);

  useEffect(() => {
    if (!moving) return;
    const fallback = setTimeout(() => {
      setMoving(false);
      if (!open) setMounted(false);
    }, 600);
    return () => clearTimeout(fallback);
  }, [moving, open]);

  if (!mounted) return null;
  return (
    <div
      inert={!open}
      aria-hidden={!open}
      data-disclosure-open={shown}
      data-moving={moving}
      className="neu-disclosure -mt-8"
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        setMoving(false);
        if (!open) setMounted(false);
      }}
    >
      <div className="neu-disclosure-clip">
        <div className="neu-disclosure-content pt-8">{children}</div>
      </div>
    </div>
  );
}
