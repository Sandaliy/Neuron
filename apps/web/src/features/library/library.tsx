import { ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/provider';
import { describe } from '../../lib/api';
import { useDeckTree } from '../../lib/decks';
import { STORAGE_KEYS, read, write } from '../../lib/storage';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';

/**
 * The library, read only.
 *
 * One request draws the whole thing: the tree arrives with the counts already
 * rolled up over each subtree, so a folder shows what is waiting inside it
 * without asking about a single one of its children.
 *
 * Making, renaming and moving decks belong to phase 6. What this proves is the
 * chain: database, repository, api, client, screen.
 */
export function LibraryScreen() {
  const t = useTranslate();
  const decks = useDeckTree();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => readOpen());

  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      writeOpen(next);

      return next;
    });
  }, []);

  return (
    <section className="flex flex-col gap-16 py-16">
      <h1 className="text-24 font-semibold text-text">{t('library.title')}</h1>

      {decks.isPending ? <SkeletonRows rows={5} /> : undefined}

      {decks.error ? (
        <ErrorState
          message={t(describe(decks.error).key, describe(decks.error).values)}
          retryLabel={t('common.retry')}
          onRetry={() => void decks.refetch()}
        />
      ) : undefined}

      {decks.data?.length === 0 ? (
        <EmptyState title={t('library.emptyTitle')} description={t('library.emptyBody')} />
      ) : undefined}

      {decks.data && decks.data.length > 0 ? (
        <>
          <ul className="flex flex-col gap-4">
            {decks.data.map((deck) => (
              <DeckRow key={deck.id} deck={deck} depth={0} open={open} onToggle={toggle} />
            ))}
          </ul>

          <p className="text-14 text-text-dim">{t('library.readOnly')}</p>
        </>
      ) : undefined}
    </section>
  );
}

function DeckRow({
  deck,
  depth,
  open,
  onToggle,
}: {
  readonly deck: DeckNode;
  readonly depth: number;
  readonly open: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}) {
  const t = useTranslate();
  const hasChildren = deck.children.length > 0;
  const expanded = open.has(deck.id);

  return (
    <li>
      <div
        className="flex min-h-44 items-center gap-8 rounded-10 px-8 hover:bg-surface"
        // The indent is a padding rather than a margin so the whole row, all
        // the way to the left edge, stays part of the same hover target.
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(deck.id)}
            aria-expanded={expanded}
            aria-label={expanded ? t('library.collapse') : t('library.expand')}
            className="flex size-44 shrink-0 items-center justify-center text-text-dim hover:text-text"
          >
            <ChevronRight
              size={16}
              strokeWidth={1.5}
              aria-hidden="true"
              className={expanded ? 'rotate-90 transition-transform' : 'transition-transform'}
            />
          </button>
        ) : (
          <span className="size-44 shrink-0" aria-hidden="true" />
        )}

        <span className="min-w-0 grow truncate text-16 text-text">{deck.name}</span>

        {/*
          Two numbers, not two words. On a 375 px screen "12 cards waiting"
          next to a deck name called Lesson 1 does not fit, so the words are in
          the label a screen reader reads and in the legend below the tree.
        */}
        {deck.due > 0 ? (
          <span
            className="shrink-0 rounded-full bg-accent px-8 py-4 text-12 font-semibold text-accent-text tabular-nums"
            aria-label={`${t('library.dueLabel')}: ${deck.due}`}
          >
            {deck.due}
          </span>
        ) : undefined}

        {deck.fresh > 0 ? (
          <span
            className="shrink-0 rounded-full border border-border px-8 py-4 text-12 text-text-dim tabular-nums"
            aria-label={`${t('library.newLabel')}: ${deck.fresh}`}
          >
            {deck.fresh}
          </span>
        ) : undefined}
      </div>

      {hasChildren && expanded ? (
        <ul className="flex flex-col gap-4">
          {deck.children.map((child) => (
            <DeckRow
              key={child.id}
              deck={child}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : undefined}
    </li>
  );
}

/** Which folders were open last time. */
function readOpen(): ReadonlySet<string> {
  const raw = read(STORAGE_KEYS.openDecks);

  if (!raw) {
    return new Set();
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeOpen(open: ReadonlySet<string>): void {
  write(STORAGE_KEYS.openDecks, JSON.stringify([...open]));
}
