import { useCallback, useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useDeckTree } from '../../lib/decks';
import { STORAGE_KEYS, read, write } from '../../lib/storage';
import { Chip } from '../../ui/chip';
import { TreeChildren, TreeRow } from '../../ui/row';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';

/**
 * The library, read only.
 *
 * One request draws the whole thing: the tree arrives with the counts already
 * rolled up over each subtree, so a deck shows what is waiting inside it
 * without asking about a single one of its children.
 *
 * Nesting is indentation and a hairline. A deck can contain decks, so the
 * interface never says folder, and there is no second noun to learn.
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
    <section className="flex flex-col gap-20">
      <h1 className="font-display text-24 tracking-tight text-primary">{t('library.title')}</h1>

      {decks.isPending ? <SkeletonRows rows={5} /> : undefined}

      {/*
        Only when there is nothing to show. A refetch that failed behind
        content already on screen leaves that content alone: the counts are a
        few minutes old rather than gone, which is the better of the two.
      */}
      {decks.error && !decks.data ? (
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
          <div className="flex flex-col gap-8">
            {decks.data.map((deck) => (
              <Deck key={deck.id} deck={deck} open={open} onToggle={toggle} />
            ))}
          </div>

          <p className="text-13 text-tertiary">{t('library.readOnly')}</p>
        </>
      ) : undefined}
    </section>
  );
}

function Deck({
  deck,
  open,
  onToggle,
}: {
  readonly deck: DeckNode;
  readonly open: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}) {
  const t = useTranslate();
  const hasChildren = deck.children.length > 0;
  const expanded = open.has(deck.id);

  return (
    <div className="flex flex-col gap-8">
      <TreeRow
        title={deck.name}
        /*
          Nothing waiting is said by the row carrying no second line, not by a
          line of zeroes. A count of nothing is the one number worth not
          printing.
        */
        {...(deck.due > 0 || deck.fresh > 0
          ? { subtitle: t('today.deckCounts', { due: deck.due, fresh: deck.fresh }) }
          : {})}
        expandable={hasChildren}
        expanded={expanded}
        {...(hasChildren ? { onClick: () => onToggle(deck.id) } : {})}
        /*
          Two numbers, not two words. On a 375 px screen "12 cards waiting"
          next to a deck name does not fit, so the words are in the label a
          screen reader reads and in the line under the name.
        */
        trailing={
          deck.due > 0 ? (
            <span aria-label={`${t('library.dueLabel')}: ${deck.due}`}>
              <Chip tone="due">{deck.due}</Chip>
            </span>
          ) : deck.fresh > 0 ? (
            <span aria-label={`${t('library.newLabel')}: ${deck.fresh}`}>
              <Chip tone="new">{deck.fresh}</Chip>
            </span>
          ) : undefined
        }
      />

      {hasChildren && expanded ? (
        <TreeChildren>
          {deck.children.map((child) => (
            <Deck key={child.id} deck={child} open={open} onToggle={onToggle} />
          ))}
        </TreeChildren>
      ) : undefined}
    </div>
  );
}

/** Which decks were open last time. */
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
