import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten } from '../../lib/decks';
import { Button } from '../../ui/button';
import { Dialog, DialogBody } from '../../ui/dialog';
import { Input } from '../../ui/input';

export function collectionPath(tree: readonly DeckNode[], item: DeckNode) {
  const names = new Map(flatten(tree).map((row) => [row.id, row.name]));
  return item.path
    .map((id) => names.get(id))
    .filter(Boolean)
    .join(' / ');
}

/** Clean names and a separate path, including inside phone pickers. */
export function CollectionPicker({
  tree,
  value,
  onChange,
  id,
  disabled = false,
}: {
  readonly tree: readonly DeckNode[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly id?: string;
  readonly disabled?: boolean;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = flatten(tree).filter((row) => row.kind === 'deck');
  const selected = options.find((row) => row.id === value);
  return (
    <>
      <Button
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
        className="w-full justify-between text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{selected?.name ?? t('library.notSet')}</span>
          {selected && (
            <span className="truncate text-12 text-tertiary">{collectionPath(tree, selected)}</span>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('note.deck')}>
        <DialogBody>
          <Input
            aria-label={t('notes.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-col gap-4">
            {options
              .filter((row) =>
                `${row.name} ${collectionPath(tree, row)}`
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
              .map((row) => (
                <Button
                  key={row.id}
                  aria-pressed={row.id === value}
                  className="w-full justify-start text-left"
                  onClick={() => {
                    onChange(row.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{row.name}</span>
                    <span className="truncate text-12 text-tertiary">
                      {collectionPath(tree, row)}
                    </span>
                  </span>
                </Button>
              ))}
          </div>
        </DialogBody>
      </Dialog>
    </>
  );
}
