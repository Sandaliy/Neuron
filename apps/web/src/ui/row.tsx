import { ChevronRight } from 'lucide-react';

import type { DragEvent, ReactNode } from 'react';

/**
 * The rows.
 *
 * One shape, three uses: a deck with its count, a setting with its value, and a
 * note in a list of five hundred. They share a skin so a list of decks and a
 * list of settings do not look like two different applications.
 *
 * A row that can be pressed is a button. Its focus ring is inset, because a
 * ring at the usual offset on a row inside a group is clipped by the group's
 * own overflow and half of it disappears.
 */

interface RowShape {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** A chip, a count, or a chevron. Anything at the far end of the row. */
  readonly trailing?: ReactNode;
  /** A disclosure control or an icon at the near end. */
  readonly leading?: ReactNode;
  /** Draws its own slab. False when it sits inside a `RowGroup`. */
  readonly standalone?: boolean;
  readonly onClick?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly expanded?: boolean | undefined;
  readonly className?: string;
  /**
   * Legacy native dragging for callers that still use it. Collection touch
   * dragging lives on its dedicated grip so the row keeps normal scrolling.
   */
  readonly draggable?: boolean;
  readonly onDragStart?: (event: DragEvent<HTMLElement>) => void;
  /** The row contains its own interactive controls (for example a menu). */
  readonly interactiveTrailing?: boolean;
}

function body({ title, subtitle, trailing, leading }: RowShape) {
  return (
    <>
      {leading}

      <span className="flex min-w-0 flex-1 flex-col gap-4 text-left">
        <span className="min-w-0 text-14 text-primary">{title}</span>
        {subtitle === undefined ? undefined : (
          <span className="min-w-0 text-12 text-secondary">{subtitle}</span>
        )}
      </span>

      {trailing}
    </>
  );
}

export function Row(props: RowShape) {
  const {
    standalone = true,
    onClick,
    disabled = false,
    expanded,
    className = '',
    draggable,
    onDragStart,
    interactiveTrailing = false,
  } = props;

  const shell = [
    'flex w-full min-h-44 items-center gap-12 px-16 py-12 text-left',
    standalone ? 'rounded-12 border' : '',
    onClick && !disabled ? 'hover:bg-raised' : '',
    disabled ? 'opacity-45' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const drag = {
    ...(draggable === undefined ? {} : { draggable }),
    ...(onDragStart === undefined ? {} : { onDragStart }),
  };

  if (!onClick) {
    return (
      <div {...(standalone ? { 'data-g': 'row' } : {})} {...drag} className={shell}>
        {body(props)}
      </div>
    );
  }

  if (interactiveTrailing) {
    return (
      <div {...(standalone ? { 'data-g': 'row' } : {})} {...drag} className={shell}>
        {props.leading}
        <button
          type="button"
          data-row=""
          disabled={disabled}
          aria-expanded={expanded}
          onClick={onClick}
          className="flex min-h-44 min-w-0 flex-1 items-center text-left"
        >
          {body({
            title: props.title,
            ...(props.subtitle === undefined ? {} : { subtitle: props.subtitle }),
          })}
        </button>
        {props.trailing}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-row=""
      {...(standalone ? { 'data-g': 'row' } : {})}
      {...drag}
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
      className={shell}
    >
      {body(props)}
    </button>
  );
}

/**
 * A row in a deck tree, with its disclosure.
 *
 * Nesting is indentation and a hairline. The caller decides whether the row
 * represents a folder or a leaf deck.
 */
export function TreeRow({
  expandable = false,
  expanded = false,
  ...rest
}: RowShape & { readonly expandable?: boolean }) {
  return (
    <Row
      {...rest}
      {...(expandable ? { expanded } : {})}
      leading={
        expandable ? (
          <ChevronRight
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className={[
              'shrink-0 text-tertiary transition-transform dur-reveal',
              expanded ? 'rotate-90' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ) : undefined
      }
    />
  );
}

/** What hangs under an open deck: one indent, one hairline, per level. */
export function TreeChildren({
  children,
  reveal = true,
}: {
  readonly children: ReactNode;
  /** Off when the children already arrive inside a Fold, which fades them itself. */
  readonly reveal?: boolean;
}) {
  return (
    <div
      data-reveal={reveal ? '' : undefined}
      className="ml-12 flex flex-col gap-8 border-l border-subtle pl-8 sm:ml-20 sm:pl-16"
    >
      {children}
    </div>
  );
}

/**
 * A note in a long list.
 *
 * Two lines, fifty two pixels, no avatar and no icon. Five hundred of these
 * scroll on a phone, and every pixel of decoration is paid for on every frame.
 *
 * The word and its meaning are what the learner reads, so both are set large
 * enough to read at a glance. Where the Note sits and when it changed are
 * context: one smaller, quieter line that never outweighs the meaning.
 */
export function DenseRow({
  word,
  meaning,
  detail,
  stamp,
  trailing,
  onClick,
  selected,
}: {
  readonly word: ReactNode;
  readonly meaning: ReactNode;
  /**
   * A third, quieter line: where the Note sits. Part of the row, so it shares
   * its surface and its press. It used to be a separate strip under the row
   * with the card's own background, which read as a different item between
   * two Notes. A long path truncates; the stamp after it does not.
   */
  readonly detail?: ReactNode;
  /** When the Note was added or changed, after the detail on the same line. */
  readonly stamp?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onClick?: () => void;
  readonly selected?: boolean | undefined;
}) {
  const third = detail !== undefined || stamp !== undefined;
  const height = third ? 'h-72' : 'h-52';
  const content = (
    <>
      {/*
        w-0 with flex-1: the column still fills the row, but a long path that
        cannot wrap no longer counts towards the row's minimum width, so it
        truncates instead of widening whatever list holds the row.
      */}
      <span className="flex w-0 min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-15 text-primary">{word}</span>
        <span className="truncate text-14 text-secondary">{meaning}</span>
        {third && (
          <span className="flex min-w-0 text-12 text-tertiary">
            {/* Read aloud the row runs on as one name; this keeps the meaning and the place apart. */}
            <span className="sr-only"> · </span>
            {detail !== undefined && <span className="min-w-0 truncate">{detail}</span>}
            {detail !== undefined && stamp !== undefined && (
              <span className="shrink-0 whitespace-pre">{' · '}</span>
            )}
            {stamp !== undefined && <span className="shrink-0">{stamp}</span>}
          </span>
        )}
      </span>
      {trailing}
    </>
  );

  if (!onClick) {
    return (
      <div className={`flex ${height} w-full min-w-0 items-center gap-12 px-16`}>{content}</div>
    );
  }

  return (
    <button
      type="button"
      data-row=""
      aria-pressed={selected}
      onClick={onClick}
      // min-w-0: a row beside other controls must be able to shrink, or a long
      // meaning pushes its status and the delete button past the edge.
      className={`flex ${height} w-full min-w-0 items-center gap-12 px-16 hover:bg-raised`}
    >
      {content}
    </button>
  );
}

/** The chevron a row carries when pressing it opens something. */
export function RowChevron() {
  return (
    <ChevronRight
      size={16}
      strokeWidth={1.5}
      aria-hidden="true"
      className="shrink-0 text-tertiary"
    />
  );
}
