import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, Folder, Layers } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten } from '../../lib/decks';
import { Button } from '../../ui/button';

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
      className="flex min-w-0 max-w-full items-center gap-4 overflow-x-auto pb-4"
    >
      <Button className="shrink-0 px-12" onClick={() => void navigate({ to: '/library' })}>
        {t('library.title')}
      </Button>
      {ids.map((key) => {
        const row = all.find((entry) => entry.id === key);
        if (!row) return null;
        const Icon = row.kind === 'folder' ? Folder : Layers;
        return (
          <span key={key} className="flex shrink-0 items-center gap-4">
            <ChevronRight size={12} aria-hidden="true" />
            <Button
              aria-current={key === id ? 'location' : undefined}
              className={row.kind === 'deck' ? 'border-accent px-12 text-accent' : 'px-12'}
              onClick={() =>
                void (row.kind === 'folder'
                  ? navigate({ to: '/library', search: { folderId: key } })
                  : navigate({ to: '/notes', search: { deckId: key } }))
              }
            >
              <Icon size={14} aria-hidden="true" />
              {row.name}
            </Button>
          </span>
        );
      })}
    </nav>
  );
}
