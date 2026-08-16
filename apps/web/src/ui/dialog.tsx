import * as RadixDialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useTranslate } from '../i18n/locale';

import type { ReactNode } from 'react';

/**
 * A dialog, optionally one that cannot be escaped.
 *
 * A panel in the middle of the screen, at every width. It used to be a sheet
 * against the bottom edge on a phone, and that was wrong for the thing it had
 * to hold. A sheet grows from the bottom, so its heading is at the top of a
 * tall box and its content is at the foot of the screen; setting up the second
 * factor put the QR code, the setup key, the field for the code and the button
 * in that order below the fold, and every one of those needs the keyboard,
 * which takes another 336 pixels away. Centred, the same content is measured
 * against the middle of the screen and both edges give way at once.
 *
 * `[data-dialog-band]` is the part that makes that work with a keyboard up. It
 * is a full width band as tall as `--visual-viewport-height`, which is the part
 * of the page a person can actually see, kept up to date by
 * `src/lib/viewport.ts`. The dialog is centred inside it, so when the keyboard
 * takes the bottom 336 pixels the band becomes 476 tall and the dialog is
 * centred in what is left rather than in a viewport iOS never shrank.
 *
 * The dialog is three parts and not one scrolling block: a heading that stays,
 * a body that scrolls if it has to, and a footer that stays. Anything long
 * enough to need the scroll is a screen that should have been split into steps,
 * and the ones in this app now are.
 *
 * The scrim is flat colour and is never blurred, because that would be a second
 * blurred layer. The screen behind goes back to 0.945 with its top edge as the
 * origin: it is still there and still theirs, the dialog is in front of it.
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
   * The screen behind the dialog is not inside this component, so the push back
   * is an attribute on the document that the stylesheet acts on. Removed on
   * unmount as well as on close, or a dialog torn down while open would leave
   * the app scaled down for good.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    document.documentElement.dataset['dialog'] = 'open';

    return () => {
      delete document.documentElement.dataset['dialog'];
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

        {/*
          The band, and nothing else, decides where the middle of the screen is.
          It takes no pointer events, so a press in the margin around the dialog
          reaches the scrim and dismisses it exactly as a press on the scrim
          does.
        */}
        <div data-dialog-band="">
          <RadixDialog.Content
            ref={content}
            data-g="panel"
            /*
             * The dialog takes the focus, not the first field in it.
             *
             * Radix focuses the first thing that can be focused, which on every
             * dialog in this app is a text field, which raises the keyboard
             * while the dialog is still on its way in. Two system animations
             * across each other is the jerk, and it is not one anything here can
             * time against: the keyboard's curve belongs to iOS. So the dialog
             * arrives, and the keyboard comes when a field is tapped, which is
             * also the tap that makes iOS willing to raise it at all.
             *
             * Focus still enters the dialog, so the trap holds and a keyboard
             * user reaches the first field with one Tab.
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
               * No focus ring on the box itself. Radix gives it `tabindex="-1"`
               * and this component moves focus to it on open, so on a step with
               * no field to type in the whole dialog was drawn with the accent
               * ring around it, as though the panel were the control. The trap
               * still holds and the first Tab still reaches the first control.
               */
              'relative z-50 flex w-full flex-col focus:outline-none',
              'max-h-full max-w-[420px]',
              'rounded-24 p-20 sm:p-24',
              'data-[state=open]:neu-panel-in data-[state=closed]:neu-panel-out',
            ].join(' ')}
          >
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
              `min-h-0` is what lets the body inside actually scroll. Without it
              a flex child refuses to shrink below its content and the dialog
              grows past the screen instead.
            */}
            <div className="flex min-h-0 flex-1 flex-col pt-16">{children}</div>

            {dismissable ? (
              <RadixDialog.Close
                className="absolute top-8 right-8 flex size-44 items-center justify-center rounded-12 text-tertiary hover:text-primary"
                aria-label={t('common.close')}
              >
                <X size={20} strokeWidth={1.5} aria-hidden="true" />
              </RadixDialog.Close>
            ) : undefined}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * The part of a dialog that scrolls, when there is more than fits.
 *
 * Everything that is not the action goes in here. The negative margin and the
 * matching padding are so a focus ring is not clipped by the scroll box it sits
 * in. On all four sides, not two: the ring on the last field was cut off along
 * the bottom edge, which reads as the button underneath sitting on top of it.
 */
export function DialogBody({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  /*
   * Sixteen between blocks, unless the caller says otherwise.
   *
   * Written as a choice rather than as a second `gap-` utility on the end,
   * because Tailwind orders its own utilities by value and not by where they
   * appear in the attribute: `gap-12` after `gap-16` loses, silently.
   */
  const gap = className.includes('gap-') ? '' : 'gap-16';

  return (
    <div
      data-dialog-body=""
      className={`-m-4 flex min-h-0 flex-1 flex-col overflow-y-auto p-4 ${gap} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
    >
      {children}
    </div>
  );
}

/**
 * The part of a dialog that does not scroll.
 *
 * The action lives here, so it is on screen whatever the keyboard is doing and
 * whatever the body is scrolled to.
 */
export function DialogFooter({ children }: { readonly children: ReactNode }) {
  return <div className="mt-16 flex shrink-0 flex-col gap-12">{children}</div>;
}

/**
 * The shape a form takes inside a dialog.
 *
 * A form has to wrap its own fields and its own submit button, so it is the
 * form and not the dialog that carries the scrolling column.
 */
export const DIALOG_FORM = 'flex min-h-0 flex-1 flex-col';
