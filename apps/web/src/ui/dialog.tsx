import * as RadixDialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useTranslate } from '../i18n/locale';

import type { ReactNode } from 'react';

/**
 * A dialog, optionally one that cannot be escaped.
 *
 * On a phone it is a sheet against the bottom edge, and that edge follows the
 * on-screen keyboard: `--keyboard-inset` is how much of the page the keyboard
 * covers, kept up to date by `src/lib/viewport.ts`. Above the phone breakpoint
 * it is a centred panel, where there is no keyboard to sit above.
 *
 * The sheet is three parts and not one scrolling block: a heading that stays,
 * a body that scrolls, and a footer that stays. That is what makes the action
 * reachable with the keyboard up. The whole sheet used to be one scrolling
 * column, so on a phone with the keys out the button was below the fold and the
 * only way to press it was to dismiss the keyboard first.
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
  const content = useRef<HTMLDivElement>(null);

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
          ref={content}
          data-g="sheet"
          /*
           * The sheet takes the focus, not the first field in it.
           *
           * Radix focuses the first thing that can be focused, which on every
           * sheet in this app is a text field, which raises the keyboard while
           * the sheet is still on its way up. Two system animations across each
           * other is the jerk, and it is not one anything here can time against:
           * the keyboard's curve belongs to iOS. So the sheet arrives, and the
           * keyboard comes when a field is tapped, which is also the tap that
           * makes iOS willing to raise it at all.
           *
           * Focus still enters the dialog, so the trap holds and a keyboard user
           * reaches the first field with one Tab.
           */
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content.current?.focus({ preventScroll: true });
          }}
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
            /*
             * Against the bottom of the page, and lifted off it by the keyboard
             * in the stylesheet, on the compositor. Writing the lift into
             * `bottom` here meant a layout pass on every frame the sheet was
             * also animating, which is what made it arrive in a jerk.
             */
            'fixed inset-x-0 bottom-0 z-50 flex flex-col',
            /*
             * Never taller than the part of the screen that is visible. The
             * variable follows the keyboard, so a sheet that was full height
             * becomes a shorter one whose body scrolls, rather than a tall one
             * with its lower half behind the keys.
             */
            'max-h-[calc(var(--visual-viewport-height)-24px)]',
            'rounded-t-34 px-20 pt-12 pb-[calc(var(--safe-bottom)+20px)]',
            'data-[state=open]:neu-sheet-in data-[state=closed]:neu-sheet-out',
            /*
             * On a wide screen it becomes a centred panel. On a phone it stays a
             * sheet against the bottom edge, where a thumb reaches.
             *
             * Centred by `inset-0` and an automatic margin rather than by half a
             * translation, because `translate` is the property the keyboard lift
             * uses and two owners of one property is a bug waiting for the first
             * laptop with a touch keyboard.
             */
            'sm:inset-0 sm:m-auto sm:h-fit sm:w-full sm:max-w-[480px]',
            'sm:max-h-[85dvh] sm:rounded-24 sm:p-24',
            'sm:data-[state=open]:neu-panel-in sm:data-[state=closed]:neu-panel-out',
          ].join(' ')}
        >
          {/* The grabber says which edge this came from, and which one it leaves by. */}
          <span
            aria-hidden="true"
            className="mx-auto mb-12 h-4 w-40 shrink-0 rounded-full bg-strong sm:hidden"
          />

          <div className="shrink-0 pr-44">
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
          </div>

          {/*
            `min-h-0` is what lets the body inside actually scroll. Without it a
            flex child refuses to shrink below its content and the sheet grows
            past the screen instead.
          */}
          <div className="flex min-h-0 flex-1 flex-col pt-20">{children}</div>

          {dismissable ? (
            <RadixDialog.Close
              className="absolute top-12 right-12 flex size-44 items-center justify-center rounded-12 text-tertiary hover:text-primary"
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

/**
 * The part of a sheet that scrolls.
 *
 * Everything that is not the action goes in here. The negative margin and the
 * matching padding are so a focus ring on the first or last control is not
 * clipped by the scroll box it sits in.
 */
export function DialogBody({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-dialog-body=""
      className={`-mx-4 flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto px-4 ${className}`.trimEnd()}
    >
      {children}
    </div>
  );
}

/**
 * The part of a sheet that does not scroll.
 *
 * The action lives here, so it is on screen whatever the keyboard is doing and
 * whatever the body is scrolled to.
 */
export function DialogFooter({ children }: { readonly children: ReactNode }) {
  return <div className="mt-16 flex shrink-0 flex-col gap-12">{children}</div>;
}

/**
 * The shape a form takes inside a sheet.
 *
 * A form has to wrap its own fields and its own submit button, so it is the
 * form and not the sheet that carries the scrolling column.
 */
export const DIALOG_FORM = 'flex min-h-0 flex-1 flex-col';
