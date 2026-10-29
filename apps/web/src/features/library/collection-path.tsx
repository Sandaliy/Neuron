import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Folder, Layers } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten } from '../../lib/decks';

/**
 * Where a collection screen sits, as a row of links.
 *
 * In `trail` mode it is the row above a screen's title: a Back control that
 * goes one level up, then the ancestors, and not the current item, which the
 * title already names. Every nested Library screen (a Folder, a Deck, a Note,
 * Deleted) uses it, so going up is always in the same place. It replaces a
 * path under the title that repeated the title, a back arrow among a Folder's
 * actions, and a different one beside Deleted's title.
 *
 * Without `trail` it is the full path including the item, for a screen that
 * acts on a collection it does not show, like Import.
 */
export function CollectionPath({
  tree,
  id,
  trail = false,
  within = false,
}: {
  readonly tree: readonly DeckNode[];
  /** The collection the screen shows. Empty for a screen directly under Library. */
  readonly id: string;
  readonly trail?: boolean;
  /** The screen shows something inside the collection, like a Note in its Deck, so the collection is an ancestor too. */
  readonly within?: boolean;
}) {
  const navigate = useNavigate();
  const t = useTranslate();
  const all = flatten(tree);
  const item = all.find((row) => row.id === id);
  if (!item && !trail) return null;
  const ids = item ? [...new Set([...item.path, item.id])] : [];
  const shown = trail && !within ? ids.filter((key) => key !== id) : ids;
  const open = (key: string | null) => {
    const row = key === null ? undefined : all.find((entry) => entry.id === key);
    if (!row) return void navigate({ to: '/library' });
    return void (row.kind === 'folder'
      ? navigate({ to: '/library', search: { folderId: row.id } })
      : navigate({ to: '/notes', search: { deckId: row.id } }));
  };
  return (
    <nav
      aria-label={t('note.deck')}
      className={[
        'flex min-w-0 max-w-full items-center gap-4 overflow-x-auto text-13 text-tertiary',
        trail ? '-ml-12' : 'pb-4',
      ].join(' ')}
    >
      {trail && (
        <button
          type="button"
          aria-label={t('common.back')}
          className="flex size-44 shrink-0 items-center justify-center rounded-12 text-accent hover:bg-fill-neutral"
          onClick={() => open(shown.at(-1) ?? null)}
        >
          <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="-ml-4 flex min-h-44 shrink-0 items-center whitespace-nowrap px-4 text-secondary hover:text-primary"
        onClick={() => open(null)}
      >
        {t('library.title')}
      </button>
      {shown.map((key) => {
        const row = all.find((entry) => entry.id === key);
        if (!row) return null;
        const Icon = row.kind === 'folder' ? Folder : Layers;
        return (
          <span key={key} className="flex shrink-0 items-center gap-4">
            <ChevronRight size={12} aria-hidden="true" />
            <button
              type="button"
              aria-current={key === id ? 'location' : undefined}
              className={`flex min-h-44 shrink-0 items-center whitespace-nowrap px-4 text-secondary hover:text-primary ${key === id ? 'text-accent' : ''}`}
              onClick={() => open(key)}
            >
              <span className="flex items-center gap-4">
                <Icon size={14} aria-hidden="true" />
                {row.name}
              </span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
