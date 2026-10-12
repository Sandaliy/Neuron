import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { Disclosure } from '../../ui/disclosure';

import type { ReactNode } from 'react';

export const workIsSettled = (entry: { state: string; acknowledgement?: unknown }) =>
  ['synchronized', 'resolved'].includes(entry.state) ||
  (entry.state === 'archived' && entry.acknowledgement !== undefined);

/** Settled receipts stay durable, with a bounded, optional presentation. */
export function SavedWork<
  T extends { operationId: string; state: string; acknowledgement?: unknown },
>({
  entries,
  label,
  render,
  title,
}: {
  entries: T[];
  label: (entry: T) => string;
  render: (entry: T) => ReactNode;
  title: string;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(10);
  const [selected, setSelected] = useState<string>();
  const active = entries.filter((entry) => !workIsSettled(entry));
  const recent = entries.filter(workIsSettled).reverse();
  return (
    <>
      {active.slice(0, limit).map(render)}
      {limit < active.length && (
        <Button variant="text" onClick={() => setLimit(limit + 10)}>
          {t('offline.moreActivity')}
        </Button>
      )}
      {recent.length > 0 && (
        <Disclosure
          title={title}
          detail={
            <span className="text-12 text-secondary" data-numeric="">
              {recent.length}
            </span>
          }
          open={open}
          onOpenChange={setOpen}
          reveal="settled"
        >
          <div className="-mx-4 flex max-h-[320px] flex-col gap-8 overflow-y-auto px-4">
            {recent.slice(0, limit).map((entry) => (
              <Disclosure
                key={entry.operationId}
                title={label(entry)}
                open={selected === entry.operationId}
                onOpenChange={(expanded) => setSelected(expanded ? entry.operationId : undefined)}
                reveal="settled"
              >
                {selected === entry.operationId && render(entry)}
              </Disclosure>
            ))}
            {limit < recent.length && (
              <Button variant="text" onClick={() => setLimit(limit + 10)}>
                {t('offline.moreActivity')}
              </Button>
            )}
          </div>
        </Disclosure>
      )}
    </>
  );
}
