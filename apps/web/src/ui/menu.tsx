import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

import type { ReactNode } from 'react';

/**
 * The actions belonging to one row.
 *
 * A deck row carries rename, move, settings and delete, and a note list carries
 * the same shape for a selection. Four actions do not fit on a row at 375
 * pixels and they are not a decision worth a dialog, so they live behind one
 * control.
 *
 * It is a floating layer, so it is glass, and it never carries a second one
 * inside it. Every item is 44 pixels tall, because the trigger is a thumb sized
 * target and so is everything it opens.
 *
 * Radix keeps the parts that are easy to get wrong: the arrow keys, escape, the
 * focus returning to the trigger on close, and the collision handling that
 * flips the panel above the row when the row is near the bottom of a phone.
 *
 * The one thing added here is that opening it does not scroll the page. Radix
 * locks the body while a menu is open, and on iOS a lock applied by setting
 * `overflow: hidden` jumps a scrolled page back to the top. `modal={false}`
 * leaves the page alone, and the trade is that a press outside closes the menu
 * without being swallowed, which is the behaviour a phone wants anyway.
 */
export function Menu({
  label,
  children,
  trigger,
}: {
  /** What a screen reader hears on the trigger. */
  readonly label: string;
  readonly children: ReactNode;
  /** Replaces the three dots, for a menu opened by something else. */
  readonly trigger?: ReactNode;
}) {
  return (
    <RadixMenu.Root modal={false}>
      <RadixMenu.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={label}
            /*
             * The press is stopped from reaching the row underneath. A deck row
             * is a button that expands the deck, and a menu opened by a press
             * that also expanded the deck reads as the interface doing two
             * things it was not asked to do.
             */
            onClick={(event) => event.stopPropagation()}
            className="flex size-44 shrink-0 items-center justify-center rounded-12 text-tertiary hover:text-primary"
          >
            <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </RadixMenu.Trigger>

      <RadixMenu.Portal>
        <RadixMenu.Content
          data-g="panel"
          align="end"
          sideOffset={4}
          collisionPadding={16}
          className={[
            'z-50 flex min-w-[200px] flex-col rounded-18 p-8',
            'data-[state=open]:neu-panel-in data-[state=closed]:neu-panel-out',
          ].join(' ')}
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/** One action in a menu. `tone` is the signal hue, for the one that removes. */
export function MenuItem({
  onSelect,
  disabled = false,
  tone = 'neutral',
  icon,
  children,
}: {
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly tone?: 'neutral' | 'danger';
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <RadixMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={[
        'flex min-h-44 cursor-default items-center gap-12 rounded-12 px-12 text-14',
        'outline-none select-none',
        'data-[highlighted]:bg-raised',
        'data-[disabled]:text-disabled',
        tone === 'danger' ? 'text-error' : 'text-primary',
      ].join(' ')}
    >
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {icon}
        </span>
      ) : undefined}
      <span className="truncate">{children}</span>
    </RadixMenu.Item>
  );
}

/** A hairline between two groups of actions. */
export function MenuSeparator() {
  return <RadixMenu.Separator className="my-8 h-px bg-subtle" />;
}
