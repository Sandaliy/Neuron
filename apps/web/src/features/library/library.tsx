import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  FolderInput,
  Folder,
  ChevronRight,
  ArrowLeft,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import type { DeckNode, DeckSettings } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { findDeck, moveProblem, useDeckActions, useDeckTree } from '../../lib/decks';
import { STORAGE_KEYS, read, write } from '../../lib/storage';
import { Button } from '../../ui/button';
import { Chip } from '../../ui/chip';
import { Dialog, DialogFooter } from '../../ui/dialog';
import { Menu, MenuItem, MenuSeparator } from '../../ui/menu';
import { TreeChildren, Row } from '../../ui/row';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';

import { DeckNameDialog, DeckSettingsDialog, MoveDeckDialog } from './deck-dialogs';

import type { DragEvent } from 'react';

/**
 * The library, now writable.
 *
 * One request draws the whole thing: the tree arrives with the counts already
 * rolled up over each subtree, so a deck shows what is waiting inside it
 * without asking about a single one of its children.
 *
 * Nesting is indentation and a hairline. Folders organize descendants; leaf
 * decks open their notes directly.
 *
 * Moving is the part that usually gets built badly. Dragging on a touch screen
 * fights with scrolling and misfires, so the way to move a deck is an action
 * that opens a picker, on every device. Dragging exists as well, and only where
 * there is a mouse: `matchMedia('(pointer: fine)')`, asked once. It is never
 * the only way to do anything.
 */
export function LibraryScreen() {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const decks = useDeckTree();
  const actions = useDeckActions();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => readOpen());
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

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

  const tree = decks.data ?? [];
  const { folderId } = useSearch({ from: '/app/library' });
  const folder = folderId ? findDeck(tree, folderId) : undefined;
  const visible = folder?.kind === 'folder' ? folder.children : tree;

  const openNotes = (id: string) => {
    if (findDeck(tree, id)?.kind === 'folder')
      void navigate({ to: '/library', search: { folderId: id } });
    else void navigate({ to: '/notes', search: { deckId: id } });
  };

  /**
   * Deleting says what happened and offers it back.
   *
   * Recovery returns the same rows and only descendants attributed to this deletion.
   */
  async function remove(deck: DeckNode) {
    await actions.remove.mutateAsync(deck.id);

    setDialog({ kind: 'none' });
    toast.show(t('library.deleted', { name: deck.name }));
  }

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <header className="flex flex-col gap-12 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-24 tracking-tight text-primary">
          {folder?.name ?? t('library.title')}
        </h1>

        <div className="flex flex-wrap items-center gap-8">
          {folder && (
            <Button
              variant="text"
              aria-label={t('common.back')}
              onClick={() =>
                void navigate({
                  to: '/library',
                  search: folder.parentId ? { folderId: folder.parentId } : {},
                })
              }
            >
              <ArrowLeft size={18} />
            </Button>
          )}
          <Button
            variant="quiet"
            onClick={() =>
              setDialog({ kind: 'create', collectionKind: 'folder', parentId: folder?.id ?? null })
            }
          >
            <Folder size={16} aria-hidden="true" />
            {t('library.newFolder')}
          </Button>
          <Button variant="quiet" onClick={() => void navigate({ to: '/library/deleted' })}>
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
            {t('deleted.title')}
          </Button>
          <Button
            variant="primary"
            className="order-first"
            onClick={() =>
              setDialog({ kind: 'create', collectionKind: 'deck', parentId: folder?.id ?? null })
            }
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {t('library.newDeck')}
          </Button>
        </div>
      </header>

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

      {!decks.isPending && visible.length === 0 ? (
        <EmptyState title={t('library.emptyTitle')} description={t('library.emptyBody')} />
      ) : undefined}

      {visible.length > 0 ? (
        <div className="flex flex-col gap-8">
          {visible.map((deck) => (
            <Deck
              key={deck.id}
              deck={deck}
              siblings={visible}
              tree={tree}
              actions={actions}
              open={open}
              onToggle={toggle}
              onOpen={openNotes}
              onAct={setDialog}
            />
          ))}
        </div>
      ) : undefined}

      <DeckDialogs
        state={dialog}
        decks={tree}
        onClose={() => setDialog({ kind: 'none' })}
        onCreate={async (parentId, name, kind) => {
          await actions.create.mutateAsync({ name, parentId, kind });

          setDialog({ kind: 'none' });
          toast.show(t('library.created', { name }));
        }}
        onRename={async (deck, name) => {
          await actions.rename.mutateAsync({ id: deck.id, name });
          setDialog({ kind: 'none' });
        }}
        onMove={async (deck, parentId) => {
          await actions.move.mutateAsync({ id: deck.id, parentId });

          setDialog({ kind: 'none' });
          toast.show(t('library.moved', { name: deck.name }));
        }}
        onSaveSettings={async (deck, settings) => {
          await actions.update.mutateAsync({ id: deck.id, settings });
          setDialog({ kind: 'none' });
        }}
        onDelete={remove}
        busy={
          actions.create.isPending ||
          actions.rename.isPending ||
          actions.move.isPending ||
          actions.update.isPending ||
          actions.remove.isPending
        }
        createError={actions.create.error}
        renameError={actions.rename.error}
      />
    </section>
  );
}

/**
 * Whether this device has a mouse.
 *
 * Asked once, when the module loads, rather than per row. It decides only
 * whether dragging is offered as well; nothing depends on it being right,
 * because the menu on every row does the same job.
 */
const POINTER_FINE =
  typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: fine)').matches;

/** Which dialog is open, and what it is about. */
type DialogState =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'create';
      readonly collectionKind: 'folder' | 'deck';
      readonly parentId: string | null;
      readonly parentName?: string;
    }
  | { readonly kind: 'rename'; readonly deck: DeckNode }
  | { readonly kind: 'move'; readonly deck: DeckNode }
  | { readonly kind: 'settings'; readonly deck: DeckNode }
  | { readonly kind: 'delete'; readonly deck: DeckNode };

function Deck({
  deck,
  siblings,
  tree,
  actions,
  open,
  onToggle,
  onOpen,
  onAct,
}: {
  readonly deck: DeckNode;
  /** The decks at this level, for moving one up or down among them. */
  readonly siblings: readonly DeckNode[];
  /** The whole tree, for deciding whether a drop is allowed. */
  readonly tree: readonly DeckNode[];
  readonly actions: ReturnType<typeof useDeckActions>;
  readonly open: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  /** Opening a deck is opening its notes. */
  readonly onOpen: (id: string) => void;
  readonly onAct: (state: DialogState) => void;
}) {
  const t = useTranslate();
  const [over, setOver] = useState(false);

  const hasChildren = deck.kind === 'folder' && deck.children.length > 0;
  const expanded = open.has(deck.id);
  const index = siblings.findIndex((entry) => entry.id === deck.id);

  function reorder(offset: number) {
    const order = siblings.map((entry) => entry.id);
    const target = index + offset;
    const moving = order[index];
    const displaced = order[target];

    if (moving === undefined || displaced === undefined) {
      return;
    }

    order[index] = displaced;
    order[target] = moving;

    void actions.reorder.mutateAsync({ parentId: deck.parentId, order });
  }

  /**
   * A deck dropped onto another one.
   *
   * Only on a pointer device, and only ever as a second way to do something the
   * menu already does. The same check the picker uses runs before the request,
   * so a drop that cannot work does nothing rather than being refused after the
   * fact.
   */
  function drop(movingId: string) {
    setOver(false);

    if (moveProblem(tree, movingId, deck.id) === undefined) {
      void actions.move.mutateAsync({ id: movingId, parentId: deck.id });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div
        className={over ? 'rounded-12 outline-2 outline-accent' : undefined}
        {...(POINTER_FINE
          ? {
              onDragOver: (event) => {
                event.preventDefault();
                setOver(true);
              },
              onDragLeave: () => setOver(false),
              onDrop: (event) => {
                event.preventDefault();
                drop(event.dataTransfer.getData('text/deck'));
              },
            }
          : {})}
      >
        <Row
          title={deck.name}
          /*
            Nothing waiting is said by the row carrying no second line, not by a
            line of zeroes. A count of nothing is the one number worth not
            printing.
          */
          {...(deck.kind === 'deck' && (deck.due > 0 || deck.fresh > 0)
            ? { subtitle: t('today.deckCounts', { due: deck.due, fresh: deck.fresh }) }
            : {})}
          leading={
            deck.kind === 'folder' ? (
              <>
                {hasChildren && (
                  <button
                    type="button"
                    aria-label={t(expanded ? 'library.collapse' : 'library.expand')}
                    aria-expanded={expanded}
                    className="flex size-44 shrink-0 items-center justify-center"
                    onClick={() => onToggle(deck.id)}
                  >
                    <ChevronRight
                      size={16}
                      className={expanded ? 'rotate-90' : ''}
                      aria-hidden="true"
                    />
                  </button>
                )}
                <Folder size={18} aria-hidden="true" className="shrink-0 text-tertiary" />
              </>
            ) : undefined
          }
          onClick={() => onOpen(deck.id)}
          {...(POINTER_FINE
            ? {
                draggable: true,
                onDragStart: (event: DragEvent) => {
                  event.dataTransfer.setData('text/deck', deck.id);
                  event.dataTransfer.effectAllowed = 'move';
                },
              }
            : {})}
          interactiveTrailing
          trailing={
            <>
              {deck.kind === 'deck' && deck.due > 0 ? (
                <span aria-label={`${t('library.dueLabel')}: ${deck.due}`}>
                  <Chip tone="due">{deck.due}</Chip>
                </span>
              ) : deck.kind === 'deck' && deck.fresh > 0 ? (
                <span aria-label={`${t('library.newLabel')}: ${deck.fresh}`}>
                  <Chip tone="new">{deck.fresh}</Chip>
                </span>
              ) : undefined}

              <Menu label={t('library.deckActions', { name: deck.name })}>
                <MenuItem
                  icon={<Pencil size={16} strokeWidth={1.5} />}
                  onSelect={() => onAct({ kind: 'rename', deck })}
                >
                  {t('library.rename')}
                </MenuItem>
                <MenuItem
                  icon={<FolderInput size={16} strokeWidth={1.5} />}
                  onSelect={() => onAct({ kind: 'move', deck })}
                >
                  {t('library.move')}
                </MenuItem>
                {deck.kind === 'folder' && (
                  <>
                    <MenuItem
                      icon={<Folder size={16} />}
                      onSelect={() =>
                        onAct({
                          kind: 'create',
                          collectionKind: 'folder',
                          parentId: deck.id,
                          parentName: deck.name,
                        })
                      }
                    >
                      {t('library.newFolder')}
                    </MenuItem>
                    <MenuItem
                      icon={<Plus size={16} />}
                      onSelect={() =>
                        onAct({
                          kind: 'create',
                          collectionKind: 'deck',
                          parentId: deck.id,
                          parentName: deck.name,
                        })
                      }
                    >
                      {t('library.newDeck')}
                    </MenuItem>
                  </>
                )}
                <MenuItem
                  icon={<Settings2 size={16} strokeWidth={1.5} />}
                  onSelect={() => onAct({ kind: 'settings', deck })}
                >
                  {t('library.settings')}
                </MenuItem>

                <MenuSeparator />

                <MenuItem
                  icon={<ArrowUp size={16} strokeWidth={1.5} />}
                  disabled={index <= 0}
                  onSelect={() => reorder(-1)}
                >
                  {t('library.moveUp')}
                </MenuItem>
                <MenuItem
                  icon={<ArrowDown size={16} strokeWidth={1.5} />}
                  disabled={index < 0 || index >= siblings.length - 1}
                  onSelect={() => reorder(1)}
                >
                  {t('library.moveDown')}
                </MenuItem>

                <MenuSeparator />

                <MenuItem
                  tone="danger"
                  icon={<Trash2 size={16} strokeWidth={1.5} />}
                  onSelect={() => onAct({ kind: 'delete', deck })}
                >
                  {t('library.delete')}
                </MenuItem>
              </Menu>
            </>
          }
        />
      </div>

      {hasChildren && expanded ? (
        <TreeChildren>
          {deck.children.map((child) => (
            <Deck
              key={child.id}
              deck={child}
              siblings={deck.children}
              tree={tree}
              actions={actions}
              open={open}
              onToggle={onToggle}
              onOpen={onOpen}
              onAct={onAct}
            />
          ))}
        </TreeChildren>
      ) : undefined}
    </div>
  );
}

function DeckDialogs({
  state,
  decks,
  onClose,
  onCreate,
  onRename,
  onMove,
  onSaveSettings,
  onDelete,
  busy,
  createError,
  renameError,
}: {
  readonly state: DialogState;
  readonly decks: readonly DeckNode[];
  readonly onClose: () => void;
  readonly onCreate: (parentId: string | null, name: string, kind: 'folder' | 'deck') => void;
  readonly onRename: (deck: DeckNode, name: string) => void;
  readonly onMove: (deck: DeckNode, parentId: string | null) => void;
  readonly onSaveSettings: (deck: DeckNode, settings: DeckSettings) => void;
  readonly onDelete: (deck: DeckNode) => void;
  readonly busy: boolean;
  readonly createError: unknown;
  readonly renameError: unknown;
}) {
  const t = useTranslate();

  return (
    <>
      <DeckNameDialog
        open={state.kind === 'create'}
        onOpenChange={onClose}
        title={t(
          state.kind === 'create' && state.collectionKind === 'folder'
            ? 'library.newFolder'
            : 'library.newDeck',
        )}
        submitLabel={t('library.createSubmit')}
        busy={busy}
        error={createError}
        onSubmit={(name) =>
          onCreate(
            state.kind === 'create' ? state.parentId : null,
            name,
            state.kind === 'create' ? state.collectionKind : 'deck',
          )
        }
      />

      <DeckNameDialog
        open={state.kind === 'rename'}
        onOpenChange={onClose}
        title={t('library.renameTitle')}
        submitLabel={t('library.renameSubmit')}
        initialName={state.kind === 'rename' ? state.deck.name : ''}
        busy={busy}
        error={renameError}
        onSubmit={(name) => {
          if (state.kind === 'rename') {
            onRename(state.deck, name);
          }
        }}
      />

      {state.kind === 'move' ? (
        <MoveDeckDialog
          open
          onOpenChange={onClose}
          deck={state.deck}
          decks={decks}
          busy={busy}
          onMove={(parentId) => onMove(state.deck, parentId)}
        />
      ) : undefined}

      {state.kind === 'settings' ? (
        <DeckSettingsDialog
          open
          onOpenChange={onClose}
          deck={state.deck}
          decks={decks}
          busy={busy}
          onSave={(settings) => onSaveSettings(state.deck, settings)}
        />
      ) : undefined}

      {state.kind === 'delete' ? (
        <ConfirmDelete deck={state.deck} busy={busy} onClose={onClose} onConfirm={onDelete} />
      ) : undefined}
    </>
  );
}

function ConfirmDelete({
  deck,
  busy,
  onClose,
  onConfirm,
}: {
  readonly deck: DeckNode;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (deck: DeckNode) => void;
}) {
  const t = useTranslate();

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={t('library.deleteTitle', { name: deck.name })}
      description={t('library.deleteBody')}
    >
      <DialogFooter>
        <Button variant="destructive" full busy={busy} onClick={() => onConfirm(deck)}>
          {t('library.deleteSubmit')}
        </Button>
        <Button variant="text" full onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </DialogFooter>
    </Dialog>
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
