import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';

import { termOf } from '@neuron/shared';
import type { MessageKey, Note } from '@neuron/shared';

import { CollectionPath } from '../features/library/collection-path';
import { OfflineAccess } from '../features/settings/offline-access';
import { useTranslate } from '../i18n/locale';
import { findDeck, useDeckTree } from '../lib/decks';
import { noteListQuery, useNote } from '../lib/notes';
import { revokeOffline, useOffline } from '../lib/offline';
import { Button } from '../ui/button';
import { RowGroup } from '../ui/card';
import { Input } from '../ui/input';
import { Row } from '../ui/row';
import { ErrorState, SkeletonRows } from '../ui/states';

/** The same routes, domain schemas and query entries, with no mutation controls mounted. */
export function OfflineCollection() {
  const t = useTranslate();
  const navigate = useNavigate();
  const client = useQueryClient();
  const state = useOffline();
  const location = useRouterState({ select: (state) => state.location });
  if (location.pathname === '/')
    return (
      <section data-screen="" className="flex flex-col gap-24">
        <header className="flex flex-col gap-4">
          <time className="text-12 text-secondary" dateTime={new Date().toISOString()}>
            {new Intl.DateTimeFormat('en', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }).format(new Date())}
          </time>
          <h1 className="text-32 tracking-tight text-primary">{t('today.title')}</h1>
        </header>
        <p className="text-14 text-secondary">
          {t(state.available ? 'offline.readOnly' : 'offline.incomplete')}
        </p>
        <Button onClick={() => void navigate({ to: '/library' })}>{t('library.title')}</Button>
      </section>
    );
  if (location.pathname === '/settings')
    return (
      <section data-screen="" className="flex flex-col gap-24">
        <h1 className="font-display text-24 tracking-tight text-primary">{t('settings.title')}</h1>
        <OfflineAccess />
        <Button
          variant="quiet"
          onClick={() => {
            revokeOffline(true);
            client.clear();
            void navigate({ to: '/sign-in' });
          }}
        >
          {t('common.signOut')}
        </Button>
      </section>
    );
  if (!state.available)
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <h1 className="font-display text-24 tracking-tight text-primary">
          {t(location.pathname === '/library' ? 'library.title' : 'notes.title')}
        </h1>
        <p role="status" className="text-14 text-secondary">
          {t('offline.incomplete')}
        </p>
      </section>
    );
  if (location.pathname === '/library')
    return <OfflineFolders folderId={(location.search as { folderId?: string }).folderId} />;
  if (location.pathname === '/notes' && !(location.search as { learning?: string }).learning)
    return <OfflineNotes deckId={(location.search as { deckId?: string }).deckId} />;
  const noteId = /^\/notes\/([^/]+)$/.exec(location.pathname)?.[1];
  if (noteId && noteId !== 'new') return <OfflineNote id={noteId} />;
  return (
    <section className="flex flex-col gap-20">
      <p className="text-14 text-secondary">{t('offline.readOnly')}</p>
      <Button onClick={() => void navigate({ to: '/library' })}>{t('library.title')}</Button>
    </section>
  );
}

function OfflineFolders({ folderId }: { folderId: string | undefined }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const tree = useDeckTree();
  if (!tree.data) return tree.error ? <LocalError /> : <SkeletonRows rows={4} />;
  const folder = folderId ? findDeck(tree.data, folderId) : undefined;
  if (folderId && !folder) return <LocalError />;
  const rows = folder?.children ?? tree.data;
  return (
    <section data-screen="" className="flex flex-col gap-20">
      <h1 className="text-24 font-semibold">{folder?.name ?? t('library.title')}</h1>
      {folder && <CollectionPath tree={tree.data} id={folder.id} />}
      <RowGroup>
        {rows.map((row) => (
          <Row
            key={row.id}
            standalone={false}
            title={row.name}
            subtitle={t(row.kind === 'folder' ? 'offline.folder' : 'offline.deck')}
            trailing={<span data-numeric="">{row.noteCount}</span>}
            onClick={() =>
              void (row.kind === 'folder'
                ? navigate({ to: '/library', search: { folderId: row.id } })
                : navigate({ to: '/notes', search: { deckId: row.id } }))
            }
          />
        ))}
      </RowGroup>
      {!rows.length && <p className="text-14 text-secondary">{t('offline.empty')}</p>}
    </section>
  );
}

function OfflineNotes({ deckId }: { deckId: string | undefined }) {
  const t = useTranslate();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const tree = useDeckTree();
  const notes = useInfiniteQuery({
    ...noteListQuery({ deckId, search, sort: 'created' }),
    placeholderData: () => undefined,
  });
  return (
    <section data-screen="" className="flex flex-col gap-20">
      <h1 className="text-24 font-semibold">
        {(deckId && tree.data ? findDeck(tree.data, deckId)?.name : undefined) ?? t('notes.title')}
      </h1>
      {deckId && tree.data && <CollectionPath tree={tree.data} id={deckId} />}
      <Input
        aria-label={t('notes.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {notes.error ? (
        <LocalError />
      ) : !notes.data ? (
        <SkeletonRows rows={4} />
      ) : (
        <OfflineNoteRows
          rows={notes.data.pages.flatMap((page) => page.items)}
          onOpen={(id) => void navigate({ to: '/notes/$noteId', params: { noteId: id } })}
        />
      )}
      {notes.data && !notes.data.pages[0]?.items.length && (
        <p className="text-14 text-secondary">{t('offline.empty')}</p>
      )}
      {notes.hasNextPage && (
        <Button variant="quiet" onClick={() => void notes.fetchNextPage()}>
          {t('offline.more')}
        </Button>
      )}
    </section>
  );
}

function OfflineNoteRows({ rows, onOpen }: { rows: Note[]; onOpen: (id: string) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const measure = () =>
      setOffset(list.current ? list.current.getBoundingClientRect().top + window.scrollY : 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current?.parentElement) observer.observe(list.current.parentElement);
    return () => observer.disconnect();
  }, [rows.length]);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 52,
    overscan: 8,
    scrollMargin: offset,
  });
  return (
    <div ref={list} data-g="card" className="overflow-hidden rounded-24 border border-glass">
      <div className="relative w-full" style={{ height: `${virtual.getTotalSize()}px` }}>
        {virtual.getVirtualItems().map((item) => {
          const note = rows[item.index];
          return note ? (
            <div
              key={note.id}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start - virtual.options.scrollMargin}px)` }}
            >
              <Row
                standalone={false}
                className="h-52"
                title={termOf(note.fields)}
                onClick={() => onOpen(note.id)}
              />
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

function fieldValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(fieldValue).join(', ');
  if (value && typeof value === 'object')
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${fieldValue(entry)}`)
      .join('\n');
  return value === null || value === undefined ? '' : String(value);
}

function OfflineNote({ id }: { id: string }) {
  const t = useTranslate();
  const query = useNote(id);
  const tree = useDeckTree();
  if (!query.data) return query.error ? <LocalError /> : <SkeletonRows rows={4} />;
  const { note } = query.data;
  return (
    <section data-screen="" className="flex flex-col gap-20">
      <h1 className="text-24 font-semibold">{termOf(note.fields)}</h1>
      {tree.data && <CollectionPath tree={tree.data} id={note.deckId} />}
      <dl className="flex flex-col gap-16">
        {Object.entries(note.fields)
          .filter(([, value]) => fieldValue(value))
          .map(([key, value]) => (
            <div key={key} className="flex flex-col gap-4">
              <dt className="text-14 text-secondary">
                {t(
                  key === 'grammar' ? 'note.section.grammar' : (`note.field.${key}` as MessageKey),
                )}
              </dt>
              <dd className="whitespace-pre-wrap break-words text-17">{fieldValue(value)}</dd>
            </div>
          ))}
      </dl>
      {note.tags.length > 0 && <p className="text-14 text-secondary">{note.tags.join(', ')}</p>}
      {note.source && <p className="text-14 text-secondary">{note.source}</p>}
    </section>
  );
}

function LocalError() {
  const t = useTranslate();
  return <ErrorState message={t('offline.missing')} retryLabel={t('common.retry')} />;
}
