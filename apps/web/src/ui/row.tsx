import { ChevronRight } from 'lucide-react';

import type { ReactNode } from 'react';

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
}

function body({ title, subtitle, trailing, leading }: RowShape) {
  return (
    <>
      {leading}

      <span className="flex min-w-0 flex-1 flex-col gap-4 text-left">
        <span className="truncate text-14 text-primary">{title}</span>
        {subtitle === undefined ? undefined : (
          <span className="truncate text-12 text-tertiary">{subtitle}</span>
        )}
      </span>

      {trailing}
    </>
  );
}

export function Row(props: RowShape) {
  const { standalone = true, onClick, disabled = false, expanded, className = '' } = props;

  const shell = [
    'flex w-full min-h-44 items-center gap-12 px-16 py-12 text-left',
    'transition-[background-color,transform,border-color]',
    standalone ? 'rounded-12 border border-subtle bg-card shadow-1' : '',
    onClick && !disabled ? 'hover:bg-raised' : '',
    disabled ? 'opacity-45' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!onClick) {
    return <div className={shell}>{body(props)}</div>;
  }

  return (
    <button
      type="button"
      data-row=""
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
 * Nesting is indentation and a hairline, never a second noun: a deck can
 * contain decks, so the interface never says folder.
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
export function TreeChildren({ children }: { readonly children: ReactNode }) {
  return <div className="ml-20 flex flex-col gap-8 border-l border-subtle pl-16">{children}</div>;
}

/**
 * A note in a long list.
 *
 * Two lines, fifty two pixels, no avatar and no icon. Five hundred of these
 * scroll on a phone, and every pixel of decoration is paid for on every frame.
 */
export function DenseRow({
  word,
  meaning,
  trailing,
  onClick,
}: {
  readonly word: ReactNode;
  readonly meaning: ReactNode;
  readonly trailing?: ReactNode;
  readonly onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-14 text-primary">{word}</span>
        <span className="truncate text-12 text-tertiary">{meaning}</span>
      </span>
      {trailing}
    </>
  );

  if (!onClick) {
    return <div className="flex h-52 w-full items-center gap-12 px-16">{content}</div>;
  }

  return (
    <button
      type="button"
      data-row=""
      onClick={onClick}
      className="flex h-52 w-full items-center gap-12 px-16 transition-colors hover:bg-raised"
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
