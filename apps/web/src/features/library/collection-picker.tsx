import { ChevronDown, ChevronRight, Folder, Layers } from 'lucide-react';
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
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
            {(() => {
              function render(rows: readonly DeckNode[]): React.ReactNode {
                return rows.map((row) => {
                  const folder = row.kind === 'folder';
                  const expanded = !collapsed.has(row.id) || query !== '';
                  if (
                    query &&
                    !folder &&
                    !`${row.name} ${collectionPath(tree, row)}`
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase())
                  )
                    return null;
                  return (
                    <div key={row.id} className="flex flex-col gap-4">
                      <Button
                        aria-expanded={folder ? expanded : undefined}
                        aria-pressed={folder ? undefined : row.id === value}
                        className={`w-full justify-start text-left ${row.id === value ? 'bg-selected border-accent' : ''}`}
                        onClick={() => {
                          if (folder)
                            setCollapsed((current) => {
                              const next = new Set(current);
                              if (!next.delete(row.id)) next.add(row.id);
                              return next;
                            });
                          else {
                            onChange(row.id);
                            setOpen(false);
                          }
                        }}
                      >
                        {folder ? (
                          <>
                            <ChevronRight size={14} className={expanded ? 'rotate-90' : ''} />
                            <Folder size={16} />
                          </>
                        ) : (
                          <Layers size={16} />
                        )}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{row.name}</span>
                          {!folder && (
                            <span className="truncate text-12 text-secondary">
                              {collectionPath(tree, row)}
                            </span>
                          )}
                        </span>
                      </Button>
                      {folder && expanded && (
                        <div className="ml-12 flex flex-col gap-4 border-l border-subtle pl-8">
                          {render(row.children)}
                        </div>
                      )}
                    </div>
                  );
                });
              }
              return render(tree);
            })()}
          </div>
        </DialogBody>
      </Dialog>
    </>
  );
}
