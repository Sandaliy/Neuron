import * as RadixDialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';

import type { ReactNode } from 'react';

/**
 * A dialog, optionally one that cannot be escaped.
 *
 * `dismissable` is the point of this component. The recovery codes screen shows
 * the only copy of the only way back into an account, and a stray tap on the
 * backdrop or a habitual press of escape would take it away for good, silently.
 * So that screen passes `false`, and then there is no close button, the
 * backdrop does nothing, and escape does nothing.
 *
 * Radix keeps the focus trap and the `aria-modal` wiring either way, so the
 * keyboard cannot wander out of the dialog into the page behind it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  dismissable = true,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly title: string;
  readonly description?: string | undefined;
  readonly dismissable?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} {...(dismissable && onOpenChange ? { onOpenChange } : {})}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <RadixDialog.Content
          onEscapeKeyDown={(event) => {
            if (!dismissable) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            if (!dismissable) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (!dismissable) {
              event.preventDefault();
            }
          }}
          className={[
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-y-auto',
            'rounded-t-14 border-t border-border bg-surface',
            'px-16 pt-24 pb-[calc(var(--safe-bottom)+24px)]',
            // On a wide screen it becomes a centred panel. On a phone it stays
            // a sheet against the bottom edge, where a thumb reaches.
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-[480px]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-14 sm:border sm:pb-24',
          ].join(' ')}
        >
          <RadixDialog.Title className="text-20 font-semibold text-text">{title}</RadixDialog.Title>

          {description ? (
            <RadixDialog.Description className="mt-8 text-16 text-text-dim">
              {description}
            </RadixDialog.Description>
          ) : (
            <VisuallyHidden>
              <RadixDialog.Description>{title}</RadixDialog.Description>
            </VisuallyHidden>
          )}

          <div className="mt-24 flex flex-col gap-16">{children}</div>

          {dismissable ? (
            <RadixDialog.Close
              className="absolute top-16 right-16 flex size-44 items-center justify-center rounded-10 text-text-dim hover:text-text"
              aria-label="Close"
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </RadixDialog.Close>
          ) : undefined}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
