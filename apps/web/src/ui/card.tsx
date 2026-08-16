import type { ReactNode } from 'react';

/**
 * The containers, which are the depth ladder made visible.
 *
 * canvas, then card, then raised, then floating. Never skip a rung, and never
 * nest a card in a card: a card inside a card is two rungs claiming the same
 * step, and it reads as a mistake even to somebody who could not say why.
 */

/**
 * A block of content on the canvas. The default container.
 *
 * It carries `data-g="card"` and names no surface of its own, which is what
 * makes the glass scope setting reach it. The stylesheet paints it: opaque at
 * the default scope, blurred when the setting says panels and cards. Written
 * with `bg-card` here instead, a utility beat the stylesheet and the setting
 * moved everything except the cards, which is most of the interface.
 */
export function Card({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div data-g="card" className={`rounded-24 border p-20 ${className}`.trimEnd()}>
      {children}
    </div>
  );
}

/**
 * A well, for something that belongs to the screen rather than sitting on it:
 * a block of codes, a preview, a quotation.
 */
export function Panel({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={`rounded-18 bg-sunken p-16 ${className}`.trimEnd()}>{children}</div>;
}

/**
 * A group of rows sharing one card, with the separators starting at the text
 * rather than at the card edge. `data-rows` is what draws them.
 */
export function RowGroup({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-g="card"
      data-rows=""
      className={`overflow-hidden rounded-24 border ${className}`.trimEnd()}
    >
      {children}
    </div>
  );
}

/** A caption over a group. Mono, small, spaced, never a heading element. */
export function GroupLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="font-mono text-12 tracking-wide text-tertiary uppercase">{children}</span>
  );
}
