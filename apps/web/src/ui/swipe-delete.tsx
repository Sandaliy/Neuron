import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

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
  } | null>(null);
  const suppress = useRef(false);
  const [offset, setOffset] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [armed, setArmed] = useState(false);
  const x = disabled ? 0 : (offset ?? (open ? -64 : 0));
  return (
    <div
      className={`relative h-52 select-none overflow-hidden ${x < 0 ? '[&_[data-direct-delete]]:invisible' : ''}`}
      style={{ touchAction: 'pan-y' }}
      data-swipe-armed={armed || undefined}
      onPointerDown={(event) => {
        if (
          disabled ||
          committing ||
          (event.pointerType === 'mouse' && event.button !== 0) ||
          (event.target as HTMLElement).closest('[data-swipe-action]')
        )
          return;
        suppress.current = false;
        onOpen(false);
        setOffset(x);
        gesture.current = {
          x: event.clientX,
          y: event.clientY,
          origin: x,
          offset: x,
          horizontal: false,
        };
      }}
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g) return;
        const dx = event.clientX - g.x;
        const dy = event.clientY - g.y;
        if (!g.horizontal) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
            gesture.current = null;
            setOffset(null);
            setArmed(false);
            return;
          }
          if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
          g.horizontal = true;
          if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
        }
        suppress.current = true;
        const width = event.currentTarget.clientWidth;
        g.offset = Math.max(-width, Math.min(0, g.origin + dx));
        setOffset(g.offset);
        setArmed(-g.offset >= commitDistance(width));
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setOffset(null);
        setArmed(false);
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g?.horizontal) {
          setOffset(null);
          return;
        }
        const commit = -g.offset >= commitDistance(event.currentTarget.clientWidth);
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
          setOffset(-event.currentTarget.clientWidth);
          void Promise.resolve(onDelete()).finally(() => {
            // A fast failure may restore the row before React unmounts it.
            setCommitting(false);
            setOffset(null);
            setArmed(false);
          });
        } else {
          onOpen(g.offset < -32);
          setOffset(null);
          setArmed(false);
        }
      }}
      onClickCapture={(event) => {
        if (!suppress.current) return;
        suppress.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {x < 0 && (
        <button
          type="button"
          data-swipe-action=""
          aria-label={label}
          className="absolute inset-y-0 right-0 flex items-center justify-end bg-error px-20 text-on-accent"
          style={{ width: Math.max(64, -x) }}
          onClick={onDelete}
        >
          <Trash2 size={20} aria-hidden="true" className={armed ? 'scale-125' : ''} />
        </button>
      )}
      <div
        className="flex h-52 bg-base transition-transform dur-reveal"
        style={{
          transform: `translateX(${x}px)`,
          transition: offset !== null && !committing ? 'none' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
