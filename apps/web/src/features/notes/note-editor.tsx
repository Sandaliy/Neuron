import { useBlocker, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

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
  EditorField,
  MessageKey,
  Note,
  NoteFields,
  NoteTypeName,
  PartOfSpeech,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { ApiFailure, describe } from '../../lib/api';
import { flatten, findDeck, settingsFor, useDeckActions, useDeckTree } from '../../lib/decks';
import { useNote, useNoteActions } from '../../lib/notes';
import { Button } from '../../ui/button';
import { GroupLabel } from '../../ui/card';
import { Dialog, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Menu, MenuItem } from '../../ui/menu';
import { ReviewTime } from '../../ui/review-time';
import { Segmented } from '../../ui/segmented';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';
import { Switch } from '../../ui/switch';
import { TextArea } from '../../ui/textarea';
import { useToast } from '../../ui/toast';
import { CollectionPath } from '../library/collection-path';
import { CollectionPicker } from '../library/collection-picker';

import { CardPreview } from './card-preview';

import type { PreviewCard } from './card-preview';
import type { KeyboardEvent } from 'react';

/**
 * Writing one note.
 *
 * Two behaviours, and the difference is deliberate. A new note needs an
 * explicit save, because a half typed word must not become a card and start
 * coming up in reviews. An existing note saves itself, because it is already a
 * card and the only question is whether the correction landed.
 *
 * The saved indicator is honest. It says Saved only after the server said so,
 * it says Saving while a request is out, and it says Not saved with a way to
 * try again when one failed. A green tick that appears on a keystroke is worse
 * than nothing, because it is believed.
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

  if (noteId !== undefined && existing.isPending) {
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <SkeletonRows rows={6} />
      </section>
    );
  }

  if (noteId !== undefined && existing.error && !existing.data) {
    return (
      <section data-screen="" className="flex flex-col gap-20">
        <ErrorState
          message={
            existing.error && describe(existing.error).key === 'error.not_found'
              ? t('note.notFound')
              : t(describe(existing.error).key, describe(existing.error).values)
          }
          retryLabel={t('common.retry')}
          onRetry={() => void existing.refetch()}
        />
      </section>
    );
  }

  return (
    <Editor
      key={noteId ?? 'new'}
      {...(existing.data === undefined
        ? {}
        : { note: existing.data.note, cards: existing.data.cards })}
      decks={decks.data ?? []}
      {...(deckId === undefined ? {} : { deckId })}
    />
  );
}

/** How the last save went, which is the only thing the indicator may claim. */
type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

function Editor({
  note,
  cards = [],
  decks,
  deckId,
}: {
  readonly note?: Note;
  readonly cards?: readonly Card[];
  readonly decks: readonly DeckNode[];
  readonly deckId?: string;
}) {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const actions = useNoteActions();
  const deckActions = useDeckActions();
  const account = useAccount();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [deck, setDeck] = useState(
    note?.deckId ?? deckId ?? flatten(decks).find((row) => row.kind === 'deck')?.id ?? '',
  );
  const [storedType, setNoteType] = useState<NoteTypeName>(note?.noteType ?? 'vocab');
  const [storedFields, setFields] = useState<Record<string, unknown>>(note?.fields ?? {});
  // Field presence is not control lifetime. Retain stored/edited grammar even
  // after clearing a value or changing the metadata which originally exposed it.
  const [retainedGrammar, setRetainedGrammar] = useState(() => filledPaths(note?.fields));
  const [grammarOpen, setGrammarOpen] = useState(() =>
    [...filledPaths(note?.fields)].some((path) => path.startsWith('grammar.')),
  );
  const [tags, setTags] = useState((note?.tags ?? []).join(', '));
  const [save, setSave] = useState<SaveState>('clean');
  const draft = useRef({ fields: storedFields, tags, version: 0 });
  const savedVersion = useRef(0);
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const [saveError, setSaveError] = useState<unknown>();
  const [statusError, setStatusError] = useState<unknown>();
  const createId = useRef(uuidV7());
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
   * starts a new one. Nothing is held in a ref, so nothing can be stale.
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
          await update({
            id: persistedId,
            fields: snapshot.fields,
            tags: snapshot.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          });
          savedVersion.current = snapshot.version;
        }
        setSave('saved');
        return true;
      } catch (error) {
        setSaveError(error);
        setSave('failed');
        return false;
      } finally {
        saving.current = undefined;
      }
    };
    saving.current = task();
    return saving.current;
  }, [persistedId, update]);

  useEffect(() => {
    if (!persistedId || conversion || save !== 'dirty') return;
    const timer = setTimeout(() => void persist(), 700);
    return () => clearTimeout(timer);
  }, [save, persistedId, storedFields, tags, persist, conversion]);

  useBlocker({
    // Start the last write, but let navigation continue. Waiting for a slow
    // mobile request here makes Back feel broken, and a failed request would
    // otherwise leave the route blocked with no useful way to leave it.
    shouldBlockFn: () => {
      if (note && !conversion) void persist();
      return false;
    },
    enableBeforeUnload: !!note && (save === 'dirty' || save === 'saving' || save === 'failed'),
  });

  function edit(next: Record<string, unknown>) {
    if (conversion) {
      setConversion({ ...conversion, fields: next });
      setConversionError(undefined);
      return;
    }
    draft.current = { ...draft.current, fields: next, version: draft.current.version + 1 };
    setFields(next);
    setSave(note ? 'dirty' : 'clean');
  }

  async function create() {
    if (deck === '') {
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
      await navigate({ to: '/notes/$noteId', params: { noteId: written.note.id } });
    } catch (error) {
      setSaveError(error);
      setSave('failed');
    }
  }

  /** Changing the type, once whatever it costs has been agreed to. */
  async function applyType(discard: boolean) {
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
      setNoteType(written.note.noteType);
      setFields(written.note.fields);
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
      <header className="flex items-center justify-between gap-12">
        <h1 className="font-display text-24 tracking-tight text-primary">
          {note ? t('note.edit') : t('note.new')}
        </h1>

        <div className="flex items-center gap-8">
          {note && !conversion && <SaveIndicator state={save} onRetry={() => void persist()} />}

          {note && !conversion ? (
            <Menu label={t('note.edit')}>
              <MenuItem
                tone="danger"
                icon={<Trash2 size={16} strokeWidth={1.5} />}
                onSelect={() => setConfirmDelete(true)}
              >
                {t('note.delete')}
              </MenuItem>
            </Menu>
          ) : undefined}
        </div>
      </header>
      <CollectionPath tree={decks} id={deck} />

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
              className="neu-reveal"
            >
              {note.status === 'active' &&
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
                })()}
            </span>
          </span>
          <div className="grid grid-cols-2 gap-8">
            <Button
              className="px-8"
              disabled={note.status === 'active' || actions.setStatus.isPending}
              onClick={() => {
                setStatusError(undefined);
                void actions.setStatus
                  .mutateAsync({ ids: [note.id], status: 'active' })
                  .catch(setStatusError);
              }}
            >
              {t('note.markActive')}
            </Button>
            <Button
              className="px-8"
              disabled={
                note.status === 'known' ||
                actions.setStatus.isPending ||
                actions.studyAgain.isPending
              }
              aria-busy={actions.setStatus.isPending}
              onClick={() => {
                setStatusError(undefined);
                void actions.setStatus
                  .mutateAsync({ ids: [note.id], status: 'known' })
                  .catch(setStatusError);
              }}
            >
              {t('note.markKnown')}
            </Button>
          </div>
          <details className="text-13 text-secondary">
            <summary className="flex min-h-44 cursor-pointer items-center">
              {t('learning.restart')}
            </summary>
            <p>{t('note.restartHint')}</p>
            <Button
              variant="text"
              disabled={actions.studyAgain.isPending || actions.setStatus.isPending}
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
          </details>
        </div>
      )}

      {note?.noteType === 'vocab' && !conversion && (
        <details className="rounded-12 border border-subtle p-12">
          <summary className="min-h-44 text-14 text-secondary">{t('study.moreDirections')}</summary>
          <p className="text-13 text-secondary">{t('study.directionHint')}</p>
          <div className="flex flex-wrap gap-8">
            {(['production', 'listening'] as const).map((direction) => (
              <Button
                key={direction}
                disabled={
                  cards.some((card) => card.direction === direction) ||
                  actions.enableDirection.isPending
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
              defaultValue={
                Array.isArray(fields['acceptedAnswers']) ? fields['acceptedAnswers'].join('\n') : ''
              }
              onBlur={(event) =>
                edit({
                  ...fields,
                  acceptedAnswers: event.target.value
                    .split('\n')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </details>
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
            <details>
              <summary className="min-h-44 cursor-pointer text-14 text-secondary">
                {t('collection.changeDestination')}
              </summary>{' '}
              <FormField
                label={t('note.deck')}
                {...(deck === '' ? { error: t('note.missingDeck') } : {})}
              >
                {(props) => (
                  <CollectionPicker {...props} tree={decks} value={deck} onChange={setDeck} />
                )}
              </FormField>
            </details>
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

        {sections.map((section) => (
          <fieldset
            key={section.name}
            disabled={(!!conversion || !note) && save === 'saving'}
            className={
              section.name === 'grammar'
                ? 'flex min-w-0 flex-col gap-16 rounded-12 border border-subtle bg-sunken p-12'
                : 'flex min-w-0 flex-col gap-16'
            }
          >
            {section.name === 'grammar' ? (
              <Button
                type="button"
                variant="text"
                className="justify-between text-secondary"
                aria-expanded={grammarOpen}
                aria-controls="note-grammar"
                onClick={() => setGrammarOpen(!grammarOpen)}
              >
                <span>{t('note.section.grammar')}</span>
                <span className="flex items-center gap-8">
                  {[...filledPaths(fields)].some((path) => path.startsWith('grammar.')) && (
                    <span className="text-12 font-normal">{t('note.grammarStored')}</span>
                  )}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className={`transition-transform dur-control ${grammarOpen ? 'rotate-180' : ''}`}
                  />
                </span>
              </Button>
            ) : section.labelKey ? (
              <GroupLabel>{t(section.labelKey)}</GroupLabel>
            ) : undefined}

            {(section.name !== 'grammar' || grammarOpen) && (
              <div
                id={section.name === 'grammar' ? 'note-grammar' : undefined}
                className={
                  section.name === 'grammar'
                    ? 'neu-reveal grid grid-cols-2 gap-16'
                    : 'flex flex-col gap-16'
                }
              >
                {section.name === 'grammar' && (
                  <div className="col-span-2 flex flex-col gap-8">
                    {!settings.targetLanguage && (
                      <p className="text-13 text-secondary">{t('note.grammarLanguage')}</p>
                    )}
                    <FormField label={t('library.targetLanguage')}>
                      {(props) => (
                        <Select
                          {...props}
                          value={settings.targetLanguage ?? ''}
                          disabled={!deck}
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
                        ? 'col-span-2 min-w-0'
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
            )}
          </fieldset>
        ))}

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
                setSave(note ? 'dirty' : 'clean');
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
      {statusError !== undefined && (
        <p role="alert" className="text-14 text-error">
          {t(describe(statusError).key, describe(statusError).values)}
        </p>
      )}

      <CardPreview cards={preview} />

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

/**
 * One field, drawn as whatever kind it is.
 *
 * The keyboard's next button moves to the field below rather than submitting,
 * which on a form of fourteen fields is the difference between typing a word
 * and hunting for the next box. A text area is left alone: Enter in one is a
 * new line, and taking that away is worse than the walk.
 */
function NoteField({
  field,
  value,
  onChange,
}: {
  readonly field: EditorField;
  readonly value: unknown;
  readonly onChange: (value: string | boolean | undefined) => void;
}) {
  const t = useTranslate();
  const id = useId();
  const text = typeof value === 'string' ? value : '';

  function advance(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();

    const form = event.currentTarget.closest('[data-screen]');
    const focusable = [...(form?.querySelectorAll<HTMLElement>('input, select, textarea') ?? [])];
    const next = focusable[focusable.indexOf(event.currentTarget) + 1];

    next?.focus();
  }

  if (field.kind === 'toggle')
    return (
      <label
        htmlFor={id}
        className="flex min-h-44 cursor-pointer items-center justify-between gap-8 text-13 text-secondary"
      >
        <span>{t(field.labelKey)}</span>
        <Switch id={id} label={t(field.labelKey)} checked={value === true} onChange={onChange} />
      </label>
    );
  return (
    <FormField
      label={t(field.labelKey)}
      {...(field.hintKey === undefined ? {} : { hint: t(field.hintKey) })}
    >
      {(props) => {
        if (field.kind === 'choice') {
          return (
            <Select {...props} value={text} onChange={(event) => onChange(event.target.value)}>
              <option value="">{t('library.notSet')}</option>
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.labelKey ? t(option.labelKey) : option.value}
                </option>
              ))}
            </Select>
          );
        }

        if (field.kind === 'multiline') {
          return (
            <TextArea
              {...props}
              value={text}
              rows={2}
              onChange={(event) => onChange(event.target.value)}
            />
          );
        }

        return (
          <Input
            {...props}
            value={text}
            autoComplete="off"
            enterKeyHint="next"
            onKeyDown={advance}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      }}
    </FormField>
  );
}

/** What the last save actually did. Never more than that. */
function SaveIndicator({
  state,
  onRetry,
}: {
  readonly state: SaveState;
  readonly onRetry: () => void;
}) {
  const t = useTranslate();

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
          {state === 'saving'
            ? t('note.saving')
            : state === 'dirty'
              ? t('note.saveNeeded')
              : t('note.saved')}
        </span>
      )}
    </div>
  );
}
