import { useTranslate } from '../i18n/locale';

import { useToast } from './toast';

import type { ReactNode, SyntheticEvent } from 'react';

/** Keep controls mounted and discoverable; intercept unavailable actions before handlers run. */
export function ServerControls({
  available,
  children,
}: {
  readonly available: boolean;
  readonly children: ReactNode;
}) {
  const t = useTranslate();
  const toast = useToast();
  function block(event: SyntheticEvent) {
    if (available || !event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    toast.show(t('offline.serverRequired'));
  }
  return (
    <fieldset
      className="contents"
      aria-disabled={!available || undefined}
      onClickCapture={block}
      onPointerDownCapture={(event) => {
        if ((event.target as Element).closest('[aria-haspopup]')) block(event);
      }}
      onKeyDownCapture={(event) => {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) block(event);
      }}
    >
      {children}
    </fieldset>
  );
}
