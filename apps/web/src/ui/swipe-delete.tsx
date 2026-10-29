import { Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { ReactNode } from 'react';

const COMMIT_MIN = 128;
const COMMIT_MAX = 200;

function commitDistance(width: number): number {
  // A phone row needs a decisive gesture, while a wide desktop row should not
  // require dragging a thumb across half the viewport.
  return Math.min(COMMIT_MAX, Math.max(COMMIT_MIN, width * 0.5));
}

/** A horizontal gesture owns the pointer only after direction is established. */
export function SwipeDelete({
  children,
  label,
  disabled,
  open,
  onOpen,
  onDelete,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly onDelete: () => void | Promise<void>;
}) {
  const gesture = useRef<{
    x: number;
    y: number;
    origin: number;
    offset: number;
    horizontal: boolean;
    width: number;
  } | null>(null);
  const suppress = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [committing, setCommitting] = useState(false);
  const paint = (x: number, dragging = false, armed = false) => {
    const element = root.current;
    if (!element || !surface.current) return;
    surface.current.style.transform = `translateX(${x}px)`;
    const states = { swipeActive: x < 0, swipeDragging: dragging, swipeArmed: armed };
    for (const [key, value] of Object.entries(states))
      if (element.dataset[key] !== String(value)) element.dataset[key] = String(value);
  };
  useLayoutEffect(() => {
    if (disabled) {
      gesture.current = null;
      suppress.current = false;
    }
    if (!gesture.current) paint(disabled ? 0 : open ? -64 : 0);
  }, [open, disabled]);
  return (
    <div
      ref={root}
      className="neu-swipe relative h-52 select-none overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(event) => {
        if (
          disabled ||
          committing ||
          (event.pointerType === 'mouse' && event.button !== 0) ||
          (event.target as HTMLElement).closest('[data-swipe-action]')
        )
          return;
        suppress.current = false;
        const x = open ? -64 : 0;
        gesture.current = {
          x: event.clientX,
          y: event.clientY,
          origin: x,
          offset: x,
          horizontal: false,
          width: event.currentTarget.clientWidth,
        };
        onOpen(false);
        paint(x, true);
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || disabled) return;
        const dx = event.clientX - g.x;
        const dy = event.clientY - g.y;
        if (!g.horizontal) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
            gesture.current = null;
            paint(0);
            return;
          }
          if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
          g.horizontal = true;
          if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
        }
        suppress.current = true;
        const width = g.width;
        g.offset = Math.max(-width, Math.min(0, g.origin + dx));
        paint(g.offset, true, -g.offset >= commitDistance(width));
      }}
      onPointerCancel={() => {
        gesture.current = null;
        paint(open ? -64 : 0);
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        gesture.current = null;
        if (disabled || !g?.horizontal) {
          paint(open ? -64 : 0);
          return;
        }
        const commit = -g.offset >= commitDistance(g.width);
        if (commit) {
          // The virtual row can unmount immediately. Keep only its departing
          // surface above the list until the leftward animation finishes.
          const surface = event.currentTarget.lastElementChild as HTMLElement;
          const bounds = event.currentTarget.getBoundingClientRect();
          const ghost = surface.cloneNode(true) as HTMLElement;
          ghost.setAttribute('aria-hidden', 'true');
          ghost.inert = true;
          Object.assign(ghost.style, {
            position: 'fixed',
            left: `${bounds.left}px`,
            top: `${bounds.top}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            pointerEvents: 'none',
            zIndex: '50',
            margin: '0',
            transition: 'none',
          });
          document.body.append(ghost);
          const style = getComputedStyle(surface);
          const reduced =
            document.documentElement.dataset['motion'] === 'reduce' ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const duration = reduced ? 0 : parseFloat(style.getPropertyValue('--dur-2'));
          const animation = ghost.animate(
            [
              { transform: `translateX(${g.offset}px)` },
              { transform: `translateX(${-bounds.width}px)`, opacity: 0 },
            ],
            { duration, easing: 'ease-out', fill: 'forwards' },
          );
          void animation.finished.finally(() => ghost.remove());
          setCommitting(true);
          paint(-g.width);
          void Promise.resolve(onDelete()).finally(() => {
            // A fast failure may restore the row before React unmounts it.
            setCommitting(false);
            paint(0);
          });
        } else {
          onOpen(g.offset < -32);
          paint(g.offset < -32 ? -64 : 0);
        }
      }}
      onClickCapture={(event) => {
        if (disabled || !suppress.current) return;
        suppress.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        data-swipe-action=""
        aria-label={label}
        className="absolute inset-0 flex items-center justify-end bg-error px-20 text-on-accent"
        onClick={onDelete}
      >
        <Trash2 size={20} aria-hidden="true" />
      </button>
      <div
        ref={surface}
        className="flex h-52 bg-base transition-transform dur-reveal hover:bg-raised"
      >
        {children}
      </div>
    </div>
  );
}
