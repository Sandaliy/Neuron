import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, Folder, Layers } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten } from '../../lib/decks';

export function CollectionPath({
  tree,
  id,
}: {
  readonly tree: readonly DeckNode[];
  readonly id: string;
}) {
  const navigate = useNavigate();
  const t = useTranslate();
  const all = flatten(tree);
  const item = all.find((row) => row.id === id);
  if (!item) return null;
  const ids = [...new Set([...item.path, item.id])];
  return (
    <nav
      aria-label={t('note.deck')}
      className="flex min-w-0 max-w-full items-center gap-4 overflow-x-auto pb-4 text-12 text-tertiary"
    >
      <button
        type="button"
        className="flex min-h-44 shrink-0 items-center whitespace-nowrap px-4 text-secondary hover:text-primary"
        onClick={() => void navigate({ to: '/library' })}
      >
        {t('library.title')}
      </button>
      {ids.map((key) => {
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
              onClick={() =>
                void (row.kind === 'folder'
                  ? navigate({ to: '/library', search: { folderId: key } })
                  : navigate({ to: '/notes', search: { deckId: key } }))
              }
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
