import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten } from '../../lib/decks';
import { Button } from '../../ui/button';
import { CollectionIcon, collectionSurface } from '../../ui/collection';
import { Dialog, DialogBody } from '../../ui/dialog';
import { Input } from '../../ui/input';
import { TreeChildren } from '../../ui/row';

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
  const all = flatten(tree);
  const names = new Map(all.map((row) => [row.id, row.name]));
  const paths = new Map(
    all.map((row) => [
      row.id,
      row.path
        .map((id) => names.get(id))
        .filter(Boolean)
        .join(' / '),
    ]),
  );
  const options = all.filter((row) => row.kind === 'deck');
  const selected = options.find((row) => row.id === value);
  const search = query.trim().toLocaleLowerCase();
  const matches = new Set(
    options
      .filter((row) => `${row.name} ${paths.get(row.id)}`.toLocaleLowerCase().includes(search))
      .map((row) => row.id),
  );
  function hasMatch(row: DeckNode): boolean {
    return row.kind === 'deck' ? matches.has(row.id) : row.children.some(hasMatch);
  }
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
        contentAlign="spread"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{selected?.name ?? t('library.notSet')}</span>
          {selected && paths.get(selected.id) && (
            <span className="truncate text-12 text-secondary">{paths.get(selected.id)}</span>
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
          <div className="flex flex-col gap-8">
            {(() => {
              function render(rows: readonly DeckNode[]): React.ReactNode {
                return rows.map((row) => {
                  const folder = row.kind === 'folder';
                  const expanded = !collapsed.has(row.id) || search !== '';
                  if (search && !hasMatch(row)) return null;
                  return (
                    <div key={row.id} className="flex flex-col gap-8">
                      <button
                        type="button"
                        data-row=""
                        aria-expanded={folder ? expanded : undefined}
                        aria-pressed={folder ? undefined : row.id === value}
                        className={`${collectionSurface(row.kind)} flex min-h-56 w-full items-center gap-12 px-12 py-8 text-left hover:bg-raised ${row.id === value ? 'bg-fill-accent-quiet' : ''}`}
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
                        {folder && (
                          <ChevronRight
                            size={16}
                            aria-hidden="true"
                            className={`shrink-0 text-secondary transition-transform dur-reveal ${expanded ? 'rotate-90' : ''}`}
                          />
                        )}
                        <CollectionIcon kind={row.kind} />
                        <span className="flex min-w-0 flex-1 flex-col gap-4">
                          <span
                            className={`text-15 leading-read text-primary ${folder ? 'font-semibold' : ''}`}
                          >
                            {row.name}
                          </span>
                          {!folder && search && paths.get(row.id) && (
                            <span className="text-12 leading-read text-secondary">
                              {paths.get(row.id)}
                            </span>
                          )}
                        </span>
                        {row.id === value && (
                          <Check size={16} aria-hidden="true" className="shrink-0 text-accent" />
                        )}
                      </button>
                      {folder && expanded && <TreeChildren>{render(row.children)}</TreeChildren>}
                    </div>
                  );
                });
              }
              return render(tree);
            })()}
            {search && matches.size === 0 && (
              <p role="status" className="p-12 text-14 text-secondary">
                {t('notes.noMatchTitle')}
              </p>
            )}
          </div>
        </DialogBody>
      </Dialog>
    </>
  );
}
