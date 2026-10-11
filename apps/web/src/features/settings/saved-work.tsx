import { useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { Disclosure } from '../../ui/disclosure';

import type { ReactNode } from 'react';

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
  const settled = (entry: T) =>
    ['synchronized', 'resolved'].includes(entry.state) ||
    (entry.state === 'archived' && entry.acknowledgement !== undefined);
  const active = entries.filter((entry) => !settled(entry));
  const recent = entries.filter(settled).reverse();
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
        >
          {open && (
            <div className="flex flex-col gap-8">
              {recent.slice(0, limit).map((entry) => (
                <Disclosure
                  key={entry.operationId}
                  title={label(entry)}
                  open={selected === entry.operationId}
                  onOpenChange={(expanded) => setSelected(expanded ? entry.operationId : undefined)}
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
          )}
        </Disclosure>
      )}
    </>
  );
}
