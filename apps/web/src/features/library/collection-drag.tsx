import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { findDeck, moveProblem } from '../../lib/decks';
import { CollectionIcon, collectionSurface } from '../../ui/collection';
import { Row } from '../../ui/row';
import { useToast } from '../../ui/toast';

import type { useDeckActions } from '../../lib/decks';
import type { ReactNode } from 'react';

interface DropTarget {
  readonly parentId: string | null;
  readonly beforeId: string | null;
  readonly invalid?: boolean;
}

export function CollectionDrag({
  tree,
  children,
  actions,
  readOnly = false,
}: {
  readonly tree: readonly DeckNode[];
  readonly children: ReactNode;
  readonly actions: ReturnType<typeof useDeckActions>;
  readonly readOnly?: boolean;
}) {
  const [active, setActive] = useState<string>();
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const placed = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    const reduced =
      document.documentElement.dataset['motion'] === 'reduce' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const row of document.querySelectorAll<HTMLElement>('[data-collection-id]')) {
      const id = row.dataset['collectionId']!;
      const bounds = row.getBoundingClientRect();
      const point = { x: bounds.left + window.scrollX, y: bounds.top + window.scrollY };
      const previous = positions.current.get(id);
      next.set(id, point);
      if (!readOnly && !reduced && previous && id !== placed.current) {
        const dx = previous.x - point.x;
        const dy = previous.y - point.y;
        if ((dx || dy) && Math.abs(dx) <= 40 && Math.abs(dy) <= 96) {
          const style = getComputedStyle(row);
          row.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
            duration: parseFloat(style.getPropertyValue('--dur-2')),
            easing: style.getPropertyValue('--ease-enter').trim(),
          });
        }
      }
    }
    positions.current = next;
    placed.current = undefined;
  }, [tree, readOnly]);
  const lastOver = useRef<DropTarget | undefined>(undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const toast = useToast();
  const t = useTranslate();

  // Keep the browser's actual pointer target as a second source of truth.
  // WebKit occasionally keeps dnd-kit's `over` one marker behind while a
  // marker is mounted during the drag; the native hit-test is current.
  useEffect(() => {
    if (!active) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const marker = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-drop-target]')?.dataset['dropTarget'];
      lastOver.current = marker ? dropTargetFromId(tree, active, marker) : undefined;
    };
    document.addEventListener('pointermove', onPointerMove, true);
    return () => document.removeEventListener('pointermove', onPointerMove, true);
  }, [active, tree]);

  return (
    <DndContext
      sensors={readOnly ? [] : sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => {
        lastOver.current = undefined;
        setActive(String(active.id));
      }}
      onDragOver={({ over }) => {
        const target = over?.data.current;
        if (isDropTarget(target)) lastOver.current = target;
      }}
      onDragMove={({ active, over, delta, activatorEvent }) => {
        const target = over?.data.current;
        if (isDropTarget(target)) {
          lastOver.current = target;
        }
        // WebKit can omit `over` for a pointer released over a newly mounted
        // marker. Hit-test the marker from the sensor's delta so the same
        // semantic target still produces one atomic move.
        const pointer = activatorEvent as MouseEvent | TouchEvent | undefined;
        if (pointer && 'clientX' in pointer && typeof pointer.clientX === 'number') {
          const element = document
            .elementFromPoint(pointer.clientX + delta.x, pointer.clientY + delta.y)
            ?.closest<HTMLElement>('[data-drop-target]');
          const marker = element?.dataset['dropTarget'];
          const hit = marker ? dropTargetFromId(tree, String(active.id), marker) : undefined;
          if (hit) lastOver.current = hit;
        }
      }}
      onDragCancel={() => {
        lastOver.current = undefined;
        setActive(undefined);
      }}
      onDragEnd={({ active, over }) => {
        setActive(undefined);
        if (readOnly) return;
        placed.current = String(active.id);
        const target =
          lastOver.current ??
          (isDropTarget(over?.data.current) ? over.data.current : undefined) ??
          dropTargetFromId(tree, String(active.id), String(over?.id ?? ''));
        lastOver.current = undefined;
        if (!target || target['invalid']) return;
        void actions.move
          .mutateAsync({
            id: String(active.id),
            parentId: target['parentId'] as string | null,
            beforeId: target['beforeId'] as string | null,
          })
          .catch((error) => toast.show(t(describe(error).key, describe(error).values), 'danger'));
      }}
    >
      {children}
      <DragOverlay dropAnimation={null} className="pointer-events-none">
        {active && !readOnly && findDeck(tree, active) && (
          <CollectionPreview deck={findDeck(tree, active)!} />
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Pointer collision can briefly report the row itself while the drop marker is
 * being reconciled. Keep the marker id self describing so a release in that
 * frame still performs the same single, exact move.
 */
function dropTargetFromId(
  tree: readonly DeckNode[],
  movingId: string,
  id: string,
): DropTarget | undefined {
  const [kind, targetId] = id.split(':');
  if (!targetId || !['before', 'after', 'inside'].includes(kind ?? '')) return undefined;
  const target = findDeck(tree, targetId);
  if (!target) return undefined;
  const parentId = kind === 'inside' ? target.id : target.parentId;
  const problem = moveProblem(tree, movingId, parentId);
  return {
    parentId,
    beforeId: kind === 'before' ? target.id : null,
    invalid: (problem !== undefined && problem !== 'same') || target.id === movingId,
  };
}

function isDropTarget(value: unknown): value is DropTarget {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as { parentId?: unknown; beforeId?: unknown };
  return (
    (target.parentId === null || typeof target.parentId === 'string') &&
    (target.beforeId === null || typeof target.beforeId === 'string')
  );
}

export function CollectionHandle({
  deck,
  disabled = false,
}: {
  readonly deck: DeckNode;
  readonly disabled?: boolean;
}) {
  const t = useTranslate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: deck.id,
    disabled,
  });
  return (
    <span
      data-dragging={isDragging}
      ref={(node) => setNodeRef(node?.closest<HTMLElement>('[data-collection-row]') ?? null)}
    >
      <button
        disabled={disabled}
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t('library.drag', { name: deck.name })}
        className="-mx-8 flex size-44 shrink-0 touch-none items-center justify-center text-tertiary"
        style={{ WebkitTouchCallout: 'none' }}
      >
        <GripVertical size={12} strokeWidth={1.5} />
      </button>
    </span>
  );
}

export function CollectionDrop({
  tree,
  id,
  parentId,
  beforeId,
  position,
}: {
  readonly tree: readonly DeckNode[];
  readonly id: string;
  readonly parentId: string | null;
  readonly beforeId: string | null;
  readonly position: 'before' | 'inside' | 'after';
}) {
  const { active } = useDndContext();
  const problem = active ? moveProblem(tree, String(active.id), parentId) : undefined;
  const invalid =
    !!active && ((problem !== undefined && problem !== 'same') || beforeId === active.id);
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: invalid,
    data: { parentId, beforeId, invalid },
  });
  if (!active || invalid) return null;
  const positionClass =
    position === 'before'
      ? '-top-16 h-32 z-30'
      : position === 'inside'
        ? 'inset-y-0 z-20'
        : '-bottom-16 h-32 z-30';
  return (
    <div
      ref={setNodeRef}
      data-drop-target={id}
      aria-hidden="true"
      className={`pointer-events-auto absolute left-0 right-0 transition-colors dur-control ${positionClass} flex items-center ${position === 'inside' && isOver ? 'rounded-12 bg-fill-accent-quiet ring-1 ring-inset ring-accent' : ''}`}
    >
      {position !== 'inside' && (
        <div
          className={`h-4 w-full rounded-full bg-fill-accent-quiet ring-1 ring-inset ring-accent transition-opacity dur-control ${isOver ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}

function deckCount(folder: DeckNode): number {
  return folder.children.reduce(
    (total, child) => total + (child.kind === 'deck' ? 1 : deckCount(child)),
    0,
  );
}

/**
 * What travels under the finger: the row itself, lifted.
 *
 * It used to be a generic list row with a different surface, a review count
 * where the Library shows a note count, and its own grip, so picking a Folder
 * up visibly turned it into something else. This draws the Library row's
 * surface, type and furniture, with nothing interactive in it, and lets the
 * stylesheet lift it.
 */
function CollectionPreview({ deck }: { readonly deck: DeckNode }) {
  const t = useTranslate();
  const folder = deck.kind === 'folder';
  return (
    <div data-collection-preview="" className="pointer-events-none w-full">
      <Row
        standalone={false}
        className={`${collectionSurface(deck.kind)} ${folder ? 'min-h-96 py-12' : 'min-h-72 py-8'} gap-4 px-8`}
        title={
          <span
            className={
              folder
                ? 'block whitespace-normal text-17 font-semibold leading-snug'
                : 'block whitespace-normal text-17 leading-snug'
            }
          >
            {deck.name}
          </span>
        }
        subtitle={
          <span className="block whitespace-normal text-13 leading-read text-secondary">
            {[
              folder
                ? t(deckCount(deck) === 1 ? 'library.oneDeck' : 'library.deckCount', {
                    count: deckCount(deck),
                  })
                : '',
              deck.noteCount === undefined
                ? ''
                : t(deck.noteCount === 1 ? 'library.oneNote' : 'library.noteCount', {
                    count: deck.noteCount,
                  }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        }
        leading={
          <>
            <span className="-mx-8 flex size-44 shrink-0 items-center justify-center text-tertiary">
              <GripVertical size={12} strokeWidth={1.5} aria-hidden="true" />
            </span>
            {folder && deck.children.length > 0 ? (
              <span className="flex min-h-44 w-56 shrink-0 items-center justify-center gap-4 text-secondary">
                <ChevronRight size={12} aria-hidden="true" />
                <CollectionIcon kind="folder" />
              </span>
            ) : (
              <span className="flex size-44 shrink-0 items-center justify-center">
                <CollectionIcon kind={deck.kind} />
              </span>
            )}
          </>
        }
        trailing={
          <span className="flex size-44 shrink-0 items-center justify-center text-secondary">
            <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden="true" />
          </span>
        }
      />
    </div>
  );
}
