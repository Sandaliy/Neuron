import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { availableForStudy, studyAvailableAt, createSchedulerConfig } from '@neuron/core';
import {
  NOTE_TYPES,
  LANGUAGE_CODES,
  editorFields,
  filledPaths,
  noteFieldsSchemas,
  openingCards,
  possibleCards,
  readField,
  reconcileCards,
  uuidV7,
  writeField,
} from '@neuron/shared';
import type {
  Card,
  LanguageCode,
  DeckNode,
  MessageKey,
  Note,
  NoteFields,
  NoteTypeName,
  PartOfSpeech,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { ApiFailure, describe } from '../../lib/api';
import { hasServerAuthority } from '../../lib/capabilities';
import { flatten, findDeck, settingsFor, useDeckActions, useDeckTree } from '../../lib/decks';
import {
  creationNote,
  noteCreationFor,
  readNoteDraft,
  saveNoteCreation,
  unsentCreation,
  updateNoteCreation,
  writeNoteDraft,
} from '../../lib/note-creation';
import { noteEditFor, saveNoteEdit } from '../../lib/note-outbox';
import { useNote, useNoteActions } from '../../lib/notes';
import { accountEpoch, offlineState, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { GroupLabel } from '../../ui/card';
import { Dialog, DialogFooter } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Menu, MenuItem } from '../../ui/menu';
import { ReviewTime } from '../../ui/review-time';
import { Segmented } from '../../ui/segmented';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';
import { TextArea } from '../../ui/textarea';
import { useToast } from '../../ui/toast';
import { CollectionPicker } from '../library/collection-picker';

import { CardPreview } from './card-preview';
import { NoteField } from './note-field';
import { NoteHeader } from './note-header';

import type { PreviewCard } from './card-preview';
import type { NoteDraft, PendingNoteCreate } from '../../lib/note-creation';
import type { PendingNoteEdit } from '../../lib/note-outbox';

/**
 * Writing one note.
 *
 * Two behaviours, and the difference is deliberate. A new note needs an
 * explicit save, because a half typed word must not become a card and start
 * coming up in reviews. An existing note saves itself, because it is already a
 * card and the only question is whether the correction landed.
 *
 * The saved indicator distinguishes a committed device draft from confirmed
 * server synchronization and offers a retry when storage fails.
 *
 * Which fields appear is decided by `editorFields` in packages/shared, from the
 * part of speech and the deck's language: a German noun is asked for its
 * article, plural and gender, a verb for its principal parts, and an adverb for
 * nothing at all. A field that already holds something is never hidden, however
 * the rules read now.
 */
export function NoteEditorScreen({
  noteId,
  deckId,
}: {
  /** Absent when this is a new note. */
  readonly noteId?: string;
  /** Where a new note will land. */
  readonly deckId?: string;
}) {
  const t = useTranslate();
  const decks = useDeckTree();
  const existing = useNote(noteId);
  const offline = useOffline();
  const savedEdit = useQuery({
    queryKey: ['note-outbox', offline.accountId, noteId],
    queryFn: async () => (await noteEditFor(offline.accountId!, noteId!)) ?? null,
    enabled: noteId !== undefined && offline.accountId !== null,
    networkMode: 'always',
  });
  // A Note this device created keeps its record until the server has it, and after.
  const savedCreation = useQuery({
    queryKey: ['note-creation', offline.accountId, noteId],
    queryFn: async () => (await noteCreationFor(offline.accountId!, noteId!)) ?? null,
    enabled: noteId !== undefined && offline.accountId !== null,
    networkMode: 'always',
  });
  // The unsaved new-Note form for this destination, if the app closed on one.
  const draftScope = deckId ?? 'any';
  const savedDraft = useQuery({
    queryKey: ['note-draft', offline.accountId, draftScope],
    queryFn: async () => (await readNoteDraft(offline.accountId!, draftScope)) ?? null,
    enabled: noteId === undefined && offline.accountId !== null,
    networkMode: 'always',
    staleTime: Infinity,
  });
  if (noteId !== undefined && offline.offline && !offline.available)
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <NoteHeader
          readOnly
          title={t('note.edit')}
          decks={decks.data ?? []}
          deckId={existing.data?.note.deckId ?? ''}
        />
        <p role="status" className="text-14 text-secondary">
          {t('offline.incomplete')}
        </p>
      </section>
    );

  if (noteId !== undefined && existing.isPending) {
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <SkeletonRows rows={6} />
      </section>
    );
  }

  if (noteId !== undefined && offline.accountId && savedEdit.isPending)
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <SkeletonRows rows={6} />
      </section>
    );
  if (noteId !== undefined && savedEdit.error && savedEdit.data === undefined)
    return (
      <section data-screen="">
        <ErrorState
          message={t('offline.changesUnavailable')}
          retryLabel={t('common.retry')}
          onRetry={() => void savedEdit.refetch()}
        />
      </section>
    );

  if (noteId !== undefined && existing.error && !existing.data) {
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <ErrorState
          message={
            offline.offline
              ? t('offline.missing')
              : existing.error && describe(existing.error).key === 'error.not_found'
                ? t('note.notFound')
                : t(describe(existing.error).key, describe(existing.error).values)
          }
          retryLabel={t('common.retry')}
          onRetry={() => void existing.refetch()}
        />
      </section>
    );
  }

  const creation = savedCreation.data ?? undefined;
  const unsent = unsentCreation(creation);
  const effectiveEdit =
    savedEdit.data?.state === 'synchronized' &&
    existing.data &&
    existing.data.note.rev >= (savedEdit.data.outcome?.revision ?? Infinity)
      ? undefined
      : (savedEdit.data ?? undefined);

  return (
    <Editor
      key={noteId ?? 'new'}
      {...(existing.data === undefined
        ? {}
        : { note: existing.data.note, cards: existing.data.cards })}
      decks={decks.data ?? []}
      local={offline.offline || offline.available || !!savedEdit.error || !!creation}
      storageUnavailable={!!savedEdit.error}
      refreshNote={existing.refetch}
      initialEdit={effectiveEdit}
      savedEdit={savedEdit.data ?? undefined}
      creation={creation}
      draft={savedDraft.data ?? undefined}
      draftScope={draftScope}
      serverActions={
        !offline.offline &&
        offline.validated &&
        !savedEdit.error &&
        !unsent &&
        // The server's own answer, with the Cards it made, comes before its actions.
        !(creation && existing.data?.local) &&
        (!effectiveEdit || effectiveEdit.state === 'synchronized')
      }
      {...(deckId === undefined ? {} : { deckId })}
    />
  );
}

/** How the last save went, which is the only thing the indicator may claim. */
type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'local' | 'failed';

function Editor({
  note,
  cards = [],
  decks,
  deckId,
  local,
  savedEdit,
  initialEdit,
  storageUnavailable,
  refreshNote,
  serverActions,
  creation,
  draft: restored,
  draftScope,
}: {
  readonly creation?: PendingNoteCreate | undefined;
  readonly draft?: NoteDraft | undefined;
  readonly draftScope: string;
  readonly note?: Note;
  readonly cards?: readonly Card[];
  readonly decks: readonly DeckNode[];
  readonly deckId?: string;
  readonly local: boolean;
  readonly savedEdit?: PendingNoteEdit | undefined;
  readonly initialEdit?: PendingNoteEdit | undefined;
  readonly storageUnavailable: boolean;
  readonly refreshNote: () => Promise<unknown>;
  readonly serverActions: boolean;
}) {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const client = useQueryClient();
  const actions = useNoteActions();
  const deckActions = useDeckActions();
  const account = useAccount();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [deck, setDeck] = useState(
    (initialEdit?.base.row['deckId'] as string | undefined) ??
      note?.deckId ??
      deckId ??
      flatten(decks).find((row) => row.kind === 'deck')?.id ??
      '',
  );
  const [storedType, setNoteType] = useState<NoteTypeName>(
    (initialEdit?.base.row['noteType'] as NoteTypeName | undefined) ?? note?.noteType ?? 'vocab',
  );
  const [storedFields, setFields] = useState<Record<string, unknown>>(
    initialEdit?.working.fields ?? note?.fields ?? {},
  );
  // Field presence is not control lifetime. Retain stored/edited grammar even
  // after clearing a value or changing the metadata which originally exposed it.
  const [retainedGrammar, setRetainedGrammar] = useState(() =>
    filledPaths(initialEdit?.working.fields ?? note?.fields),
  );
  const [grammarOpen, setGrammarOpen] = useState(() =>
    [...filledPaths(initialEdit?.working.fields ?? note?.fields)].some((path) =>
      path.startsWith('grammar.'),
    ),
  );
  const [tags, setTags] = useState((initialEdit?.working.tags ?? note?.tags ?? []).join(', '));
  const [acceptedAnswers, setAcceptedAnswers] = useState(() => {
    const values = (initialEdit?.working.fields ?? note?.fields)?.['acceptedAnswers'];
    return Array.isArray(values) ? values.join('\n') : '';
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [save, setSave] = useState<SaveState>(initialEdit ? 'local' : 'clean');
  const [owner] = useState(() => ({ accountId: offlineState().accountId, epoch: accountEpoch() }));
  const [committedEdit, setCommittedEdit] = useState(initialEdit);
  const [committedCreation, setCommittedCreation] = useState(creation);
  const latestCreation =
    committedCreation && (!creation || committedCreation.updatedAt > creation.updatedAt)
      ? committedCreation
      : creation;
  const unsent = unsentCreation(latestCreation);
  const draft = useRef({ fields: storedFields, tags, version: 0 });
  const localEditor = useRef(local || !!savedEdit || !!creation);
  // Whether this Note was created on this device, so edits ask its record first.
  const deviceCreated = useRef(!!creation);
  useEffect(() => {
    if (creation) {
      deviceCreated.current = true;
      localEditor.current = true;
    }
  }, [creation]);
  const observed = useRef(note);
  useEffect(() => {
    if (local || savedEdit) localEditor.current = true;
    const latest = savedEdit ?? committedEdit;
    const parsed = noteFieldsSchemas[storedType].safeParse(draft.current.fields);
    const currentTags = [
      ...new Set(
        draft.current.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ].sort();
    // A fresh row can become the baseline only when every displayed content
    // value is already saved and matches it. Pending work keeps its original base.
    if (
      note &&
      note.rev >= (observed.current?.rev ?? 0) &&
      draft.current.version === savedVersion.current &&
      (!latest || latest.state === 'synchronized') &&
      note.noteType === storedType &&
      parsed.success &&
      JSON.stringify(parsed.data) === JSON.stringify(note.fields) &&
      JSON.stringify(currentTags) === JSON.stringify([...note.tags].sort())
    )
      observed.current = note;
  }, [local, savedEdit, committedEdit, note, storedType]);
  const savedVersion = useRef(0);
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const [saveError, setSaveError] = useState<unknown>();
  const [statusError, setStatusError] = useState<unknown>();
  const createId = useRef(restored?.noteId ?? uuidV7());
  const created = useRef(false);
  const restartId = useRef(uuidV7());
  const [conversion, setConversion] = useState<{
    type: NoteTypeName;
    fields: Record<string, unknown>;
  }>();
  const [confirmConversion, setConfirmConversion] = useState(false);
  const [conversionError, setConversionError] = useState<unknown>();
  const typeControl = useRef<HTMLDivElement>(null);
  const conversionActions = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const noteType = conversion?.type ?? storedType;
  const fields = conversion?.fields ?? storedFields;
  const validFields = noteFieldsSchemas[noteType].safeParse(fields);

  const settings = settingsFor(decks, deck);
  const ladder = settings.ladder;
  const savePlan = useRef({ cards, ladder, storedType });
  useEffect(() => {
    savePlan.current = { cards, ladder, storedType };
  }, [cards, ladder, storedType]);
  const tagList = tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');

  const sections = editorFields({
    noteType,
    ...(typeof fields['partOfSpeech'] === 'string'
      ? { partOfSpeech: fields['partOfSpeech'] as PartOfSpeech }
      : {}),
    ...(settings.targetLanguage === undefined ? {} : { targetLanguage: settings.targetLanguage }),
    filled: new Set([...filledPaths(fields), ...retainedGrammar]),
  });

  /**
   * The cards this note produces, as the server would produce them.
   *
   * For a new note that is the opening set. For one that exists it is what
   * reconciling its current cards against these fields would do, which is what
   * makes a card about to be removed visible before the edit is made.
   */
  const preview = ((): PreviewCard[] => {
    if (!validFields.success) return [];
    const parsed = validFields.data;

    if (!note) {
      return openingCards(noteType, parsed, settings.ladder).map((card) => ({
        ...card,
        change: 'adds' as const,
      }));
    }

    const change = reconcileCards(
      cards.map((card) => ({ direction: card.direction, slot: card.slot, reps: card.reps })),
      noteType,
      parsed,
      settings.ladder,
      storedType,
    );

    const drawn = possibleCards(noteType, parsed);
    const oldCards = possibleCards(storedType, storedFields as NoteFields);
    const kept = new Set(change.keep.map((card) => `${card.direction}:${card.slot}`));
    const repsOf = new Map(cards.map((card) => [`${card.direction}:${card.slot}`, card.reps]));

    return [
      ...drawn
        .filter((card) => kept.has(`${card.direction}:${card.slot}`))
        .map((card) => ({
          ...card,
          change: 'keeps' as const,
          reps: repsOf.get(`${card.direction}:${card.slot}`) ?? 0,
        })),
      ...change.create.map((card) => ({ ...card, change: 'adds' as const })),
      ...change.remove.map((card) => ({
        direction: card.direction,
        slot: card.slot,
        front:
          oldCards.find((old) => old.direction === card.direction && old.slot === card.slot)
            ?.front ?? [],
        back:
          oldCards.find((old) => old.direction === card.direction && old.slot === card.slot)
            ?.back ?? [],
        change: 'removes' as const,
        reps: card.reps,
      })),
    ];
  })();

  const removal =
    note && validFields.success
      ? reconcileCards(
          cards.map((card) => ({ direction: card.direction, slot: card.slot, reps: card.reps })),
          noteType,
          validFields.data,
          settings.ladder,
          storedType,
        )
      : undefined;

  /**
   * An existing note saves itself, a beat after the typing stops.
   *
   * Seven hundred milliseconds. Long enough that a word being typed is one
   * request rather than nine, short enough that putting the phone down mid word
   * does not lose it.
   *
   * The debounce is the effect being torn down and set up again: every
   * keystroke changes the fields, which cancels the timer that was waiting and
   * starts a new one. The single writer drains the latest draft snapshot.
   */
  const update = actions.update.mutateAsync;
  const persistedId = note?.id;

  const persist = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (!persistedId || draft.current.version === savedVersion.current)
      return Promise.resolve(true);
    setSave('saving');
    setSaveError(undefined);
    const task = async () => {
      try {
        // A single writer drains newer edits after the outstanding request.
        while (savedVersion.current !== draft.current.version) {
          const snapshot = draft.current;
          const values = {
            fields: snapshot.fields,
            tags: snapshot.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          };
          if (offlineState().offline) localEditor.current = true;
          const unsentSave = deviceCreated.current
            ? await updateNoteCreation(owner, persistedId, values)
            : undefined;
          if (unsentSave) setCommittedCreation(unsentSave);
          else if (localEditor.current || offlineState().offline) {
            const plan = savePlan.current;
            const parsed = noteFieldsSchemas[plan.storedType].safeParse(snapshot.fields);
            const removes = parsed.success
              ? reconcileCards(
                  plan.cards.map((card) => ({
                    direction: card.direction,
                    slot: card.slot,
                    reps: card.reps,
                  })),
                  plan.storedType,
                  parsed.data,
                  [...plan.ladder],
                  plan.storedType,
                ).remove.length > 0
              : false;
            setCommittedEdit(
              await saveNoteEdit(owner, persistedId, values, observed.current, removes),
            );
          } else {
            await update({ id: persistedId, ...values });
          }
          savedVersion.current = snapshot.version;
        }
        setSave(localEditor.current || offlineState().offline ? 'local' : 'saved');
        return true;
      } catch (error) {
        setSaveError(
          localEditor.current ? new Error('collection_note_storage', { cause: error }) : error,
        );
        setSave('failed');
        return false;
      } finally {
        saving.current = undefined;
      }
    };
    saving.current = task();
    return saving.current;
  }, [persistedId, update, owner]);

  useEffect(() => {
    if (!persistedId || conversion || save !== 'dirty') return;
    const timer = setTimeout(() => void persist(), 700);
    return () => clearTimeout(timer);
  }, [save, persistedId, storedFields, tags, persist, conversion]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void persist();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', persist);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', persist);
    };
  }, [persist]);

  /*
   * The new-Note form outlives a closed app. It is kept on the device as the
   * learner types and comes back when this destination's form opens again,
   * with the Note id it will be saved under. Leaving through the app still asks
   * first, and discarding there removes it.
   */
  const form = useRef({ deck, noteType: storedType, fields: storedFields, tags, save });
  useEffect(() => {
    form.current = { deck, noteType: storedType, fields: storedFields, tags, save };
  }, [deck, storedType, storedFields, tags, save]);
  const discarded = useRef(false);
  const restoredDraft = useRef(false);
  useEffect(() => {
    if (note || !restored || restoredDraft.current || form.current.save !== 'clean') return;
    restoredDraft.current = true;
    createId.current = restored.noteId;
    setDeck(restored.deckId);
    setNoteType(restored.noteType);
    setFields(restored.fields);
    setRetainedGrammar(filledPaths(restored.fields));
    setTags(restored.tags);
    setSave('dirty');
  }, [note, restored]);
  const saveDraft = useCallback(() => {
    const current = form.current;
    if (note || created.current || discarded.current || !owner.accountId) return;
    if (current.save !== 'dirty' && current.save !== 'failed') return;
    void writeNoteDraft(owner, draftScope, {
      noteId: createId.current,
      deckId: current.deck,
      noteType: current.noteType,
      fields: current.fields,
      tags: current.tags,
    }).catch(() => undefined);
  }, [note, owner, draftScope]);
  useEffect(() => {
    if (note || save !== 'dirty') return;
    const timer = setTimeout(saveDraft, 700);
    return () => clearTimeout(timer);
  }, [note, save, storedFields, tags, deck, storedType, saveDraft]);
  useEffect(() => {
    if (note) return;
    const flush = () => {
      if (document.visibilityState === 'hidden') saveDraft();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', saveDraft);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', saveDraft);
    };
  }, [note, saveDraft]);

  const unsavedDraft =
    !!conversion || save === 'failed' || (!note && (save === 'dirty' || save === 'saving'));
  const navigation = useBlocker({
    withResolver: true,
    // A local draft must commit before this form unmounts. Otherwise a late
    // storage failure would lose the only visible copy. Typing stays independent.
    // Explicit drafts and known failures need a deliberate discard.
    shouldBlockFn: () => {
      if (note && !conversion && save !== 'failed') {
        if (localEditor.current && draft.current.version !== savedVersion.current)
          return persist().then((saved) => !saved);
        void persist();
      }
      return unsavedDraft && !created.current;
    },
    enableBeforeUnload: unsavedDraft || (!!note && (save === 'dirty' || save === 'saving')),
  });

  function edit(next: Record<string, unknown>) {
    if (conversion) {
      setConversion({ ...conversion, fields: next });
      setConversionError(undefined);
      return;
    }
    draft.current = { ...draft.current, fields: next, version: draft.current.version + 1 };
    setFields(next);
    setSave('dirty');
  }

  async function create() {
    if (deck === '') {
      return;
    }
    const input = {
      noteId: createId.current,
      deckId: deck,
      noteType,
      fields,
      tags: [...new Set(tagList)],
    };
    // With a complete download the Note is saved here first and sent after,
    // the same as an edit. The server still makes its Cards.
    if (offlineState().available && owner.accountId) {
      setSave('saving');
      setSaveError(undefined);
      try {
        const saved = await saveNoteCreation(owner, input, draftScope);
        client.setQueryData(['note-creation', owner.accountId, input.noteId], saved);
        client.setQueryData(['note-outbox', owner.accountId, input.noteId], null);
        client.setQueryData(['notes', input.noteId], (data: unknown) =>
          data ? data : { note: creationNote(saved), cards: [], local: true },
        );
        created.current = true;
        setSave('saved');
        await navigate({ to: '/notes/$noteId', params: { noteId: input.noteId } });
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        // An account change or an id already used must not become a second write.
        if (
          !hasServerAuthority() ||
          [
            'collection_note_exists',
            'collection_account_changed',
            'collection_no_account',
          ].includes(reason)
        ) {
          setSaveError(
            new Error(
              reason === 'collection_deck_missing'
                ? 'collection_create_deck'
                : 'collection_note_create_storage',
              { cause: error },
            ),
          );
          setSave('failed');
          return;
        }
      }
    } else if (!hasServerAuthority()) {
      toast.show(t('offline.serverRequired'));
      return;
    }

    setSave('saving');
    setSaveError(undefined);

    try {
      const written = await actions.create.mutateAsync({
        // Generated here, so a retry after a timeout that actually landed does
        // not write the note twice.
        id: createId.current,
        deckId: deck,
        noteType,
        fields,
        tags: tagList,
      });

      setSave('saved');
      created.current = true;
      if (owner.accountId) void writeNoteDraft(owner, draftScope, undefined).catch(() => undefined);
      await navigate({ to: '/notes/$noteId', params: { noteId: written.note.id } });
    } catch (error) {
      setSaveError(error);
      setSave('failed');
    }
  }

  /** Changing the type, once whatever it costs has been agreed to. */
  async function applyType(discard: boolean) {
    if (!serverActions || !hasServerAuthority()) {
      toast.show(t('offline.serverRequired'));
      return;
    }
    if (!note || !conversion || !validFields.success || save === 'saving') {
      return;
    }
    setConfirmConversion(false);
    setConversionError(undefined);
    setSave('saving');

    try {
      const written = await actions.update.mutateAsync({
        id: note.id,
        noteType: conversion.type,
        fields: validFields.data,
        ...(discard ? { discardCards: true } : {}),
      });
      observed.current = written.note;
      setNoteType(written.note.noteType);
      setFields(written.note.fields);
      setAcceptedAnswers(
        Array.isArray(written.note.fields['acceptedAnswers'])
          ? written.note.fields['acceptedAnswers'].join('\n')
          : '',
      );
      draft.current = { fields: written.note.fields, tags, version: savedVersion.current };
      setConversion(undefined);
      setSave('saved');
      focusType();
    } catch (error) {
      setSave('clean');
      setConversionError(error);
      if (error instanceof ApiFailure && error.code === 'cards_would_be_lost') {
        setConfirmConversion(true);
      }
    }
  }

  function focusType() {
    requestAnimationFrame(() =>
      typeControl.current?.querySelector<HTMLInputElement>('input:checked')?.focus(),
    );
  }

  function cancelConversion() {
    setConversion(undefined);
    setConversionError(undefined);
    setConfirmConversion(false);
    focusType();
  }

  function closeConfirmation() {
    setConfirmConversion(false);
    requestAnimationFrame(() => conversionActions.current?.querySelector('button')?.focus());
  }

  function chooseType(next: NoteTypeName) {
    if (next === noteType || save === 'saving') {
      return;
    }
    if (note) {
      if (next === storedType) cancelConversion();
      else setConversion({ type: next, fields: {} });
      setConversionError(undefined);
      return;
    }
    setNoteType(next);
    setFields({});
  }

  return (
    <section data-screen="" data-editor="" className="flex flex-col gap-20">
      <NoteHeader
        title={note ? t('note.edit') : t('note.new')}
        decks={decks}
        deckId={deck}
        actions={
          <div className="flex items-center gap-8">
            {note && !conversion && (
              <SaveIndicator
                state={save}
                savedEdit={
                  committedEdit && (!savedEdit || committedEdit.sequence > savedEdit.sequence)
                    ? committedEdit
                    : savedEdit
                }
                creation={latestCreation}
                onRetry={() => void persist()}
              />
            )}

            {note && !conversion ? (
              <Menu label={t('note.edit')}>
                <MenuItem
                  tone="danger"
                  icon={<Trash2 size={16} strokeWidth={1.5} />}
                  disabled={!serverActions}
                  onSelect={() => setConfirmDelete(true)}
                >
                  {t('note.delete')}
                </MenuItem>
              </Menu>
            ) : undefined}
          </div>
        }
      />

      {note && !conversion && (
        <div
          className="flex flex-col gap-12 border-y border-subtle py-16"
          aria-label={t('note.studyStatus')}
        >
          <span
            role="status"
            className="flex items-center justify-between gap-8 text-14 text-secondary"
          >
            <span className="rounded-8 bg-sunken px-12 py-8">
              {t(`note.status.${note.status}`)}
            </span>
            <span
              key={`${note.status}:${cards.map((card) => card.state).join()}`}
              className={`neu-reveal ${serverActions || unsent ? '' : 'invisible'}`}
              aria-hidden={!serverActions && !unsent}
            >
              {unsent ? (
                <span className="flex flex-col gap-4 text-right">
                  {t('offline.create.cardsLater')}
                </span>
              ) : (
                note.status === 'active' &&
                (() => {
                  const config = createSchedulerConfig({
                    timezone: account.data?.timezone ?? 'UTC',
                    dayCutoffHour: account.data?.dayCutoffHour ?? 4,
                  });
                  const live = cards.filter((card) => !card.suspendedAt);
                  const ready = live.filter((card) =>
                    availableForStudy(
                      { state: card.state, due: new Date(card.due) },
                      new Date(now),
                      config,
                    ),
                  ).length;
                  const next = live
                    .map((card) =>
                      studyAvailableAt(
                        { state: card.state, due: new Date(card.due) },
                        config,
                      ).toISOString(),
                    )
                    .filter((due) => new Date(due).getTime() > now)
                    .sort()[0];
                  return (
                    <span className="flex flex-col gap-4 text-right">
                      <span>{t('note.readyCards', { count: ready })}</span>
                      {next && <ReviewTime due={next} />}
                    </span>
                  );
                })()
              )}
            </span>
          </span>
          <div className="grid grid-cols-2 gap-8">
            <Button
              className="px-8"
              disabled={!serverActions || note.status === 'active' || actions.setStatus.isPending}
              onClick={() => {
                setStatusError(undefined);
                void actions.setStatus
                  .mutateAsync({ ids: [note.id], status: 'active' })
                  // The bulk acknowledgement contains no Note revision.
                  .then(() => (localEditor.current ? refreshNote() : undefined))
                  .catch(setStatusError);
              }}
            >
              {t('note.markActive')}
            </Button>
            <Button
              className="px-8"
              disabled={
                !serverActions ||
                note.status === 'known' ||
                actions.setStatus.isPending ||
                actions.studyAgain.isPending
              }
              aria-busy={actions.setStatus.isPending}
              onClick={() => {
                setStatusError(undefined);
                void actions.setStatus
                  .mutateAsync({ ids: [note.id], status: 'known' })
                  .then(() => (localEditor.current ? refreshNote() : undefined))
                  .catch(setStatusError);
              }}
            >
              {t('note.markKnown')}
            </Button>
          </div>
          <Disclosure quiet title={t('learning.restart')}>
            <p className="text-13 text-secondary">{t('note.restartHint')}</p>
            <Button
              variant="text"
              disabled={
                !serverActions || actions.studyAgain.isPending || actions.setStatus.isPending
              }
              onClick={() => {
                setStatusError(undefined);
                void actions.studyAgain
                  .mutateAsync({ noteId: note.id, id: restartId.current })
                  .then(() => {
                    restartId.current = uuidV7();
                  })
                  .catch(setStatusError);
              }}
            >
              {t('learning.restart')}
            </Button>
          </Disclosure>
        </div>
      )}

      {note?.noteType === 'vocab' && !conversion && (
        <Disclosure quiet title={t('study.moreDirections')}>
          <div className="flex flex-col gap-12">
            <p className="text-13 text-secondary">{t('study.directionHint')}</p>
            <div className="flex flex-wrap gap-8">
              {(['production', 'listening'] as const).map((direction) => (
                <Button
                  key={direction}
                  disabled={
                    cards.some((card) => card.direction === direction) ||
                    actions.enableDirection.isPending ||
                    !serverActions
                  }
                  onClick={() => {
                    setStatusError(undefined);
                    void actions.enableDirection
                      .mutateAsync({ noteId: note.id, direction })
                      .catch(setStatusError);
                  }}
                >
                  {t(`study.direction.${direction}`)}
                </Button>
              ))}
            </div>
            <label className="flex flex-col gap-8 text-14 text-secondary">
              {t('study.acceptedAnswers')}
              <TextArea
                value={acceptedAnswers}
                onChange={(event) => {
                  setAcceptedAnswers(event.target.value);
                  edit({
                    ...fields,
                    acceptedAnswers: event.target.value
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  });
                }}
              />
            </label>
          </div>
        </Disclosure>
      )}

      {conversion && (
        <p role="status" className="text-14 text-secondary">
          {t('note.conversionDraft')}
        </p>
      )}
      <div ref={typeControl} className="flex flex-col gap-20">
        <FormField label={t('note.type')}>
          {() => (
            <Segmented
              label={t('note.type')}
              value={noteType}
              disabled={
                (!serverActions && !!note) ||
                save === 'saving' ||
                (!!note && !conversion && (save === 'dirty' || save === 'failed'))
              }
              options={NOTE_TYPES.map((type) => ({
                value: type,
                label: t(`note.type.${type}` as MessageKey),
              }))}
              onChange={chooseType}
            />
          )}
        </FormField>

        {!note &&
          (deckId ? (
            <Disclosure quiet title={t('collection.changeDestination')}>
              <FormField
                label={t('note.deck')}
                {...(deck === '' ? { error: t('note.missingDeck') } : {})}
              >
                {(props) => (
                  <CollectionPicker {...props} tree={decks} value={deck} onChange={setDeck} />
                )}
              </FormField>
            </Disclosure>
          ) : (
            <>
              {' '}
              <FormField
                label={t('note.deck')}
                {...(deck === '' ? { error: t('note.missingDeck') } : {})}
              >
                {(props) => (
                  <CollectionPicker {...props} tree={decks} value={deck} onChange={setDeck} />
                )}
              </FormField>
            </>
          ))}

        {sections.map((section) => {
          const content = (
            <div
              id={section.name === 'grammar' ? 'note-grammar' : undefined}
              className={
                section.name === 'grammar'
                  ? 'grid grid-cols-2 gap-16 max-[340px]:grid-cols-1'
                  : 'flex flex-col gap-16'
              }
            >
              {section.name === 'grammar' && (
                <div className="col-span-full flex flex-col gap-8">
                  {!settings.targetLanguage && (
                    <p className="text-13 text-secondary">{t('note.grammarLanguage')}</p>
                  )}
                  <FormField label={t('library.targetLanguage')}>
                    {(props) => (
                      <Select
                        {...props}
                        value={settings.targetLanguage ?? ''}
                        disabled={!deck || !serverActions}
                        onChange={(event) => {
                          const targetLanguage = event.target.value as LanguageCode;
                          if (!targetLanguage) return;
                          deckActions.update.mutate(
                            {
                              id: deck,
                              settings: { ...findDeck(decks, deck)?.settings, targetLanguage },
                            },
                            { onError: (error) => toast.show(t(describe(error).key)) },
                          );
                        }}
                      >
                        <option value="">{t('library.notSet')}</option>
                        {LANGUAGE_CODES.map((code) => (
                          <option key={code} value={code}>
                            {t(`lang.${code}` as MessageKey)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  {settings.targetLanguage && section.fields.length === 0 && (
                    <p className="text-13 text-secondary">{t('note.grammarUnavailable')}</p>
                  )}
                </div>
              )}
              {section.fields.map((field) => (
                <div
                  key={field.path}
                  className={
                    section.name === 'grammar' && field.kind === 'multiline'
                      ? 'col-span-full min-w-0'
                      : 'min-w-0'
                  }
                >
                  <NoteField
                    key={field.path}
                    field={field}
                    value={readField(fields, field.path)}
                    onChange={(value) => {
                      if (field.path.startsWith('grammar.'))
                        setRetainedGrammar((paths) => new Set([...paths, field.path]));
                      edit(writeField(fields, field.path, value));
                    }}
                  />
                </div>
              ))}
            </div>
          );
          return (
            <fieldset
              key={section.name}
              disabled={(!!conversion || !note) && save === 'saving'}
              className={
                section.name === 'grammar'
                  ? 'flex min-w-0 flex-col rounded-12 border border-subtle bg-sunken p-12'
                  : 'flex min-w-0 flex-col gap-16'
              }
            >
              {section.name === 'grammar' ? (
                <Disclosure
                  title={t('note.section.grammar')}
                  detail={
                    [...filledPaths(fields)].some((path) => path.startsWith('grammar.')) ? (
                      <span className="text-12 text-secondary">{t('note.grammarStored')}</span>
                    ) : undefined
                  }
                  open={grammarOpen}
                  onOpenChange={setGrammarOpen}
                  reveal="progressive"
                >
                  {content}
                </Disclosure>
              ) : (
                <>
                  {section.labelKey && <GroupLabel>{t(section.labelKey)}</GroupLabel>}
                  {content}
                </>
              )}
            </fieldset>
          );
        })}

        <FormField label={t('note.tags')} hint={t('note.tagsHint')}>
          {(props) => (
            <Input
              {...props}
              value={tags}
              disabled={!!conversion || (!note && save === 'saving')}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(event) => {
                draft.current = {
                  ...draft.current,
                  tags: event.target.value,
                  version: draft.current.version + 1,
                };
                setTags(event.target.value);
                setSave('dirty');
              }}
            />
          )}
        </FormField>
      </div>

      {saveError !== undefined && (
        <p role="alert" className="text-14 text-error">
          {t(describe(saveError).key, describe(saveError).values)}
        </p>
      )}
      {storageUnavailable && (
        <p role="alert" className="text-14 text-error">
          {t('offline.changesUnavailable')}
        </p>
      )}
      {statusError !== undefined && (
        <p role="alert" className="text-14 text-error">
          {t(describe(statusError).key, describe(statusError).values)}
        </p>
      )}

      {conversion || preview.some((card) => card.change === 'removes') ? (
        <CardPreview cards={preview} />
      ) : (
        <Disclosure
          title={t('note.preview')}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          className="border-t border-subtle pt-8"
        >
          <CardPreview cards={preview} labelled={false} />
        </Disclosure>
      )}

      {conversion && (
        <div ref={conversionActions} className="flex flex-col gap-8">
          {!validFields.success && (
            <p className="text-14 text-secondary">{t('note.conversionRequired')}</p>
          )}
          {conversionError !== undefined && (
            <p role="alert" className="text-14 text-error">
              {t(describe(conversionError).key, describe(conversionError).values)}
            </p>
          )}
          <Button
            variant="primary"
            full
            busy={save === 'saving'}
            disabled={!validFields.success}
            onClick={() =>
              removal && removal.reviewsLost > 0
                ? setConfirmConversion(true)
                : void applyType(false)
            }
          >
            {t('note.conversionApply')}
          </Button>
          <Button variant="text" full disabled={save === 'saving'} onClick={cancelConversion}>
            {t('note.conversionCancel')}
          </Button>
        </div>
      )}

      {note ? undefined : (
        <Button
          variant="primary"
          full
          busy={save === 'saving'}
          disabled={preview.length === 0 || deck === ''}
          onClick={() => void create()}
        >
          {t('note.save')}
        </Button>
      )}

      <Dialog
        open={navigation.status === 'blocked'}
        onOpenChange={() => navigation.reset?.()}
        title={t('note.leaveTitle')}
        description={t('note.leaveBody')}
      >
        <DialogFooter>
          <Button
            variant="destructive"
            full
            onClick={() => {
              if (!note && owner.accountId) {
                discarded.current = true;
                void writeNoteDraft(owner, draftScope, undefined).catch(() => undefined);
              }
              navigation.proceed?.();
            }}
          >
            {t('note.discardChanges')}
          </Button>
          <Button variant="text" full onClick={() => navigation.reset?.()}>
            {t('note.keepEditing')}
          </Button>
        </DialogFooter>
      </Dialog>

      {confirmConversion && conversion ? (
        <Dialog
          open
          onOpenChange={closeConfirmation}
          title={t('note.typeChangeTitle')}
          description={t('note.typeChangeBody')}
        >
          <DialogFooter>
            <Button variant="destructive" full onClick={() => void applyType(true)}>
              {t('note.typeChangeSubmit')}
            </Button>
            <Button variant="text" full onClick={closeConfirmation}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : undefined}

      {confirmDelete && note ? (
        <Dialog
          open
          onOpenChange={() => setConfirmDelete(false)}
          title={t('note.deleteTitle')}
          description={t('note.deleteBody')}
        >
          <DialogFooter>
            <Button
              variant="destructive"
              full
              busy={actions.remove.isPending}
              onClick={async () => {
                if (!serverActions || !hasServerAuthority()) {
                  toast.show(t('offline.serverRequired'));
                  return;
                }
                await actions.remove.mutateAsync(note.id);

                toast.show(t('note.deleted'));
                await navigate({ to: '/notes', search: { deckId: note.deckId } });
              }}
            >
              {t('note.delete')}
            </Button>
            <Button variant="text" full onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : undefined}
    </section>
  );
}

/** What the last save actually did. Never more than that. */
function SaveIndicator({
  state,
  savedEdit: edit,
  creation,
  onRetry,
}: {
  readonly state: SaveState;
  readonly savedEdit?: PendingNoteEdit | undefined;
  readonly creation?: PendingNoteCreate | undefined;
  readonly onRetry: () => void;
}) {
  const t = useTranslate();
  // A later edit speaks for the Note; before one exists, its creation does.
  const savedEdit: { state: string } | undefined = edit ?? creation;

  return (
    <div
      className="flex h-44 w-[144px] shrink-0 items-center justify-end text-right text-13"
      aria-live="polite"
    >
      {state === 'failed' ? (
        <button type="button" onClick={onRetry} className="min-h-44 text-error">
          {t('note.saveFailed')} · {t('common.retry')}
        </button>
      ) : (
        <span role="status" className="text-secondary">
          {state === 'saving' ? (
            t('note.saving')
          ) : state === 'dirty' ? (
            t('note.saveNeeded')
          ) : savedEdit && ['conflict', 'unsupported', 'rejected'].includes(savedEdit.state) ? (
            <Link to="/settings">{t(`offline.note.${savedEdit.state}` as MessageKey)}</Link>
          ) : savedEdit?.state === 'draft' ? (
            t('offline.note.incomplete')
          ) : savedEdit?.state === 'synchronized' ? (
            t('offline.note.synchronized')
          ) : state === 'local' || savedEdit ? (
            t('offline.note.saved')
          ) : (
            t('note.saved')
          )}
        </span>
      )}
    </div>
  );
}
