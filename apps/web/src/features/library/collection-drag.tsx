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
import { GripVertical, Folder, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { findDeck, moveProblem } from '../../lib/decks';
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
}: {
  readonly tree: readonly DeckNode[];
  readonly children: ReactNode;
  readonly actions: ReturnType<typeof useDeckActions>;
}) {
  const [active, setActive] = useState<string>();
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
      sensors={sensors}
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
        {active && (
          <div className="pointer-events-none w-full opacity-90 shadow-2">
            <Row
              title={findDeck(tree, active)?.name ?? ''}
              leading={
                findDeck(tree, active)?.kind === 'folder' ? (
                  <Folder size={20} />
                ) : (
                  <Layers size={20} />
                )
              }
              subtitle={
                findDeck(tree, active)?.kind === 'deck'
                  ? t('today.deckCounts', {
                      due: findDeck(tree, active)?.due ?? 0,
                      fresh: findDeck(tree, active)?.fresh ?? 0,
                    })
                  : undefined
              }
              trailing={<GripVertical size={12} />}
            />
          </div>
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

export function CollectionHandle({ deck }: { readonly deck: DeckNode }) {
  const t = useTranslate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: deck.id,
  });
  return (
    <span
      data-dragging={isDragging}
      ref={(node) => setNodeRef(node?.closest<HTMLElement>('[data-collection-row]') ?? null)}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t('library.drag', { name: deck.name })}
        className="flex size-44 shrink-0 touch-none items-center justify-center text-tertiary"
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
          className={`h-[2px] w-full bg-fill-accent transition-opacity dur-control ${isOver ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
