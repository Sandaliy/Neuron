import * as RadixDialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import { useEffect } from 'react';

import { useTranslate } from '../i18n/locale';

import type { ReactNode } from 'react';

/**
 * A dialog, optionally one that cannot be escaped.
 *
 * On a phone it is a sheet against the bottom edge, and that edge follows the
 * on-screen keyboard: `--keyboard-inset` is how much of the page the keyboard
 * covers, kept up to date by `src/lib/viewport.ts`. Above the phone breakpoint
 * it is a centred panel, where there is no keyboard to sit above. That
 * behaviour is older than this styling and is preserved exactly.
 *
 * The sheet rises from the bottom edge and the screen behind it goes back to
 * 0.945 with its top edge as the origin. The screen is still there and still
 * theirs; the sheet is in front of it, not instead of it. The scrim is flat
 * colour and is never blurred, because that would be a second blurred layer.
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
  const t = useTranslate();

  /*
   * The screen behind the sheet is not inside this component, so the push back
   * is an attribute on the document that the stylesheet acts on. Removed on
   * unmount as well as on close, or a dialog torn down while open would leave
   * the app scaled down for good.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    document.documentElement.dataset['sheet'] = 'open';

    return () => {
      delete document.documentElement.dataset['sheet'];
    };
  }, [open]);

  return (
    <RadixDialog.Root open={open} {...(dismissable && onOpenChange ? { onOpenChange } : {})}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={[
            'fixed inset-0 z-40 bg-scrim',
            'data-[state=open]:neu-scrim-in data-[state=closed]:opacity-0',
          ].join(' ')}
        />

        <RadixDialog.Content
          data-g="sheet"
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
            'fixed inset-x-0 z-50 flex flex-col overflow-y-auto',
            /*
             * The bottom edge is the top of the keyboard, not the bottom of the
             * page. With no keyboard up the inset is zero and this is the
             * bottom of the page, which is where a sheet belongs.
             */
            'bottom-[var(--keyboard-inset)]',
            /*
             * Never taller than the part of the screen that is visible. The
             * variable follows the keyboard, so a sheet that was full height
             * becomes a shorter one that scrolls rather than a tall one with
             * its lower half behind the keys.
             */
            'max-h-[calc(var(--visual-viewport-height)-32px)]',
            'rounded-t-34 px-20 pt-12 pb-[calc(var(--safe-bottom)+24px)]',
            'data-[state=open]:neu-sheet-in data-[state=closed]:neu-sheet-out',
            // On a wide screen it becomes a centred panel. On a phone it stays
            // a sheet against the bottom edge, where a thumb reaches.
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-[480px]',
            'sm:max-h-[90dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-24 sm:p-24',
            'sm:data-[state=open]:neu-panel-in sm:data-[state=closed]:neu-panel-out',
          ].join(' ')}
        >
          {/* The grabber says which edge this came from, and which one it leaves by. */}
          <span
            aria-hidden="true"
            className="mx-auto mb-12 h-4 w-40 shrink-0 rounded-full bg-strong sm:hidden"
          />

          <RadixDialog.Title className="font-display text-20 tracking-snug text-primary">
            {title}
          </RadixDialog.Title>

          {description ? (
            <RadixDialog.Description className="mt-8 text-14 leading-body text-secondary">
              {description}
            </RadixDialog.Description>
          ) : (
            <VisuallyHidden>
              <RadixDialog.Description>{title}</RadixDialog.Description>
            </VisuallyHidden>
          )}

          <div className="mt-20 flex flex-col gap-16">{children}</div>

          {dismissable ? (
            <RadixDialog.Close
              className="absolute top-12 right-12 flex size-44 items-center justify-center rounded-12 text-tertiary transition-colors hover:text-primary"
              aria-label={t('common.close')}
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </RadixDialog.Close>
          ) : undefined}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
