import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { termOf, editorFields, filledPaths, readField } from '@neuron/shared';
import type { Note, NoteFields, PartOfSpeech } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { request } from '../../lib/api';
import { applySavedNote, retryNoteEdits, keepServerNote, noteEdits } from '../../lib/note-outbox';
import { useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { Disclosure } from '../../ui/disclosure';
import { NoteField } from '../notes/note-field';

import { workIsSettled } from './saved-work';

export function PendingNotes() {
  const t = useTranslate();
  const state = useOffline();
  const client = useQueryClient();
  const entries = useQuery({
    queryKey: ['note-outbox', state.accountId],
    queryFn: () => noteEdits(state.accountId!),
    enabled: state.accountId !== null,
    networkMode: 'always',
  });
  const retry = useMutation({ mutationFn: retryNoteEdits });
  const resolve = useMutation({ mutationFn: applySavedNote });
  const keep = useMutation({ mutationFn: keepServerNote });
  // Waiting edits are counted in the section's status; only decisions are listed.
  const saved = (entries.data ?? []).filter(
    (entry) => !workIsSettled(entry) && entry.state !== 'pending',
  );
  if (!entries.error && saved.length === 0) return null;
  return (
    <section aria-label={t('offline.note.savedChanges')} className="flex flex-col gap-12">
      {saved.length > 0 && (
        <p className="text-14 font-semibold text-primary">{t('offline.note.savedChanges')}</p>
      )}
      <div className="flex flex-col gap-16">
        {entries.error && <p role="alert">{t('offline.changesUnavailable')}</p>}
        {saved.map((entry) => {
          const original = entry.base.row as unknown as Note;
          return (
            <div
              key={entry.operationId}
              className="flex flex-col gap-8 border-t border-subtle pt-12"
            >
              <p className="text-14 text-primary">{termOf(entry.working.fields as NoteFields)}</p>
              <p role="status" className="text-13 text-secondary">
                {t(`offline.note.${entry.state}`)}
              </p>
              <SavedVersion
                title={t('offline.note.localVersion')}
                noteType={original.noteType}
                fields={entry.working.fields}
                tags={entry.working.tags}
              />
              {['conflict', 'unsupported', 'rejected'].includes(entry.state) && (
                <>
                  <p className="text-13 text-secondary">
                    {entry.outcome?.reason === 'deleted_remotely'
                      ? t('offline.note.deleted')
                      : entry.state === 'unsupported'
                        ? t('offline.note.cardChange')
                        : entry.state === 'rejected'
                          ? t('offline.note.deliveryRejected')
                          : t('offline.note.changed')}
                  </p>
                  <SavedVersion
                    title={t('offline.note.originalVersion')}
                    noteType={original.noteType}
                    fields={original.fields}
                    tags={original.tags}
                  />
                </>
              )}
              {entry.state === 'conflict' && entry.outcome?.reason === 'changed_remotely' && (
                <RemoteComparison
                  accountId={entry.accountId}
                  id={entry.entityId}
                  enabled={state.validated && !state.offline}
                />
              )}
              <div className="flex flex-wrap gap-8">
                <Button
                  variant="text"
                  onClick={() =>
                    void navigator.clipboard.writeText(JSON.stringify(entry.working, null, 2))
                  }
                >
                  {t('offline.note.copyDraft')}
                </Button>
                {['conflict', 'unsupported', 'rejected'].includes(entry.state) && (
                  <Button
                    variant="text"
                    onClick={() =>
                      void navigator.clipboard.writeText(JSON.stringify(original, null, 2))
                    }
                  >
                    {t('offline.note.copyOriginal')}
                  </Button>
                )}
                {entry.state === 'pending' && (
                  <Button
                    variant="quiet"
                    disabled={!state.validated || state.offline}
                    busy={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    {t('common.retry')}
                  </Button>
                )}
                {entry.state === 'conflict' && entry.outcome?.reason === 'changed_remotely' && (
                  <Button
                    variant="quiet"
                    disabled={!state.validated || state.offline}
                    busy={resolve.isPending}
                    onClick={() => resolve.mutate(entry.operationId)}
                  >
                    {t('offline.note.applyDraft')}
                  </Button>
                )}
                {['conflict', 'unsupported', 'rejected'].includes(entry.state) && (
                  <Button
                    variant="text"
                    busy={keep.isPending}
                    onClick={() => {
                      keep.mutate(entry.operationId, {
                        onSuccess: () => {
                          // This explicit recovery happens in Settings. The next
                          // editor visit must not initialize from a cached draft overlay.
                          client.removeQueries({
                            queryKey: ['notes', entry.entityId],
                            exact: true,
                          });
                        },
                      });
                    }}
                  >
                    {t('offline.note.keepServer')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {(retry.error || resolve.error || keep.error) && (
          <p role="alert" className="text-13 text-error">
            {t(
              resolve.error?.message === 'collection_note_scope_changed'
                ? 'offline.note.scopeChanged'
                : 'offline.renameRetryFailed',
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function RemoteComparison({
  accountId,
  id,
  enabled,
}: {
  accountId: string;
  id: string;
  enabled: boolean;
}) {
  const t = useTranslate();
  const remote = useQuery({
    queryKey: ['offline-note-remote', accountId, id],
    queryFn: () => request<{ note: Note }>(`/notes/${id}`),
    enabled,
  });
  if (!enabled || !remote.data) return null;
  return (
    <SavedVersion
      title={t('offline.currentVersion')}
      noteType={remote.data.note.noteType}
      fields={remote.data.note.fields}
      tags={remote.data.note.tags}
    />
  );
}

function SavedVersion({
  title,
  noteType,
  fields,
  tags,
}: {
  title: string;
  noteType: Note['noteType'];
  fields: Record<string, unknown>;
  tags: string[];
}) {
  const t = useTranslate();
  const sections = editorFields({
    noteType,
    filled: filledPaths(fields),
    ...(typeof fields['partOfSpeech'] === 'string'
      ? { partOfSpeech: fields['partOfSpeech'] as PartOfSpeech }
      : {}),
  });
  return (
    <Disclosure quiet title={title}>
      <div className="flex flex-col gap-12 text-13 text-secondary">
        {sections
          .flatMap((section) => section.fields)
          .filter((field) => readField(fields, field.path) !== undefined)
          .map((field) => (
            <NoteField
              key={field.path}
              field={field}
              value={readField(fields, field.path)}
              readOnly
            />
          ))}
        {Array.isArray(fields['acceptedAnswers']) && (
          <p>
            {t('study.acceptedAnswers')}: {fields['acceptedAnswers'].join(', ')}
          </p>
        )}
        <p>
          {t('note.tags')}: {tags.join(', ')}
        </p>
      </div>
    </Disclosure>
  );
}
