import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { flatten } from '../../lib/decks';
import { BackLink } from '../../ui/page-header';

/** Opens a Folder, a Deck, or the Library itself. */
export function useOpenCollection(tree: readonly DeckNode[]) {
  const navigate = useNavigate();
  return (key: string | null) => {
    const row = key === null ? undefined : flatten(tree).find((entry) => entry.id === key);
    if (!row) return void navigate({ to: '/library' });
    return void (row.kind === 'folder'
      ? navigate({ to: '/library', search: { folderId: row.id } })
      : navigate({ to: '/notes', search: { deckId: row.id } }));
  };
}

/**
 * One level up the hierarchy, named for where it lands.
 *
 * `within` is for a screen that shows something inside the collection, like a
 * Note in its Deck: Back then goes to the collection itself.
 */
export function CollectionBack({
  tree,
  id,
  within = false,
}: {
  readonly tree: readonly DeckNode[];
  /** The collection the screen shows. Empty for a screen directly under Library. */
  readonly id: string;
  readonly within?: boolean;
}) {
  const t = useTranslate();
  const open = useOpenCollection(tree);
  const all = flatten(tree);
  const item = all.find((row) => row.id === id);
  const targetId = within ? (item?.id ?? null) : (item?.path.at(-1) ?? item?.parentId ?? null);
  const target = targetId === null ? undefined : all.find((row) => row.id === targetId);
  return <BackLink label={target?.name ?? t('library.title')} onClick={() => open(targetId)} />;
}

/**
 * Where a collection sits, as one quiet line under a title.
 *
 * Shown only when Back does not already say it: a Note opened from search or a
 * check, a Deck opened from search results, an Import aimed at a Deck. Each name
 * opens that level. It wraps rather than scrolling sideways, so a long path is
 * readable at once on a phone.
 */
export function CollectionLocation({
  tree,
  id,
  includeSelf = false,
}: {
  readonly tree: readonly DeckNode[];
  readonly id: string;
  /** Name the collection itself as the last step, for a screen about something inside it. */
  readonly includeSelf?: boolean;
}) {
  const t = useTranslate();
  const open = useOpenCollection(tree);
  const all = flatten(tree);
  const item = all.find((row) => row.id === id);
  if (!item) return null;
  const ids = [...new Set(includeSelf ? [...item.path, item.id] : item.path)];
  const steps = ids
    .map((key) => all.find((row) => row.id === key))
    .filter((row): row is DeckNode => row !== undefined);
  return (
    <nav
      aria-label={t('note.deck')}
      data-location=""
      className="flex min-w-0 flex-wrap items-center gap-x-4 text-13 text-secondary"
    >
      <LocationStep label={t('library.title')} onClick={() => open(null)} />
      {steps.map((row) => (
        <span key={row.id} className="flex min-w-0 items-center gap-4">
          <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-tertiary" />
          <LocationStep label={row.name} onClick={() => open(row.id)} />
        </span>
      ))}
    </nav>
  );
}

function LocationStep({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Drawn 32 tall so the line stays quiet under the title; the press area
      // reaches 48 with the margin the pseudo-element adds above and below.
      className="relative flex min-h-32 min-w-0 items-center rounded-8 hover:text-primary after:absolute after:inset-x-0 after:-inset-y-8 after:content-['']"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
