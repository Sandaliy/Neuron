import { useNavigate } from '@tanstack/react-router';
import { Check, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  NOTE_TYPES,
  editorFields,
  filledPaths,
  openingCards,
  readField,
  reconcileCards,
  uuidV7,
  writeField,
} from '@neuron/shared';
import type {
  Card,
  DeckNode,
  EditorField,
  MessageKey,
  Note,
  NoteFields,
  NoteStatus,
  NoteTypeName,
  PartOfSpeech,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { flatten, settingsFor, useDeckTree } from '../../lib/decks';
import { useNote, useNoteActions } from '../../lib/notes';
import { Button } from '../../ui/button';
import { GroupLabel } from '../../ui/card';
import { Dialog, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Menu, MenuItem, MenuSeparator } from '../../ui/menu';
import { Segmented } from '../../ui/segmented';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';
import { Switch } from '../../ui/switch';
import { TextArea } from '../../ui/textarea';
import { useToast } from '../../ui/toast';

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

  if (noteId !== undefined && existing.error) {
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

  const [deck, setDeck] = useState(note?.deckId ?? deckId ?? flatten(decks)[0]?.id ?? '');
  const [noteType, setNoteType] = useState<NoteTypeName>(note?.noteType ?? 'vocab');
  const [fields, setFields] = useState<Record<string, unknown>>(note?.fields ?? {});
  const [tags, setTags] = useState((note?.tags ?? []).join(', '));
  const [save, setSave] = useState<SaveState>('clean');
  const [pendingType, setPendingType] = useState<NoteTypeName | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    filled: filledPaths(fields),
  });

  /**
   * The cards this note produces, as the server would produce them.
   *
   * For a new note that is the opening set. For one that exists it is what
   * reconciling its current cards against these fields would do, which is what
   * makes a card about to be removed visible before the edit is made.
   */
  const preview = ((): PreviewCard[] => {
    const parsed = fields as NoteFields;

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
    );

    const drawn = openingCards(noteType, parsed, settings.ladder);
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
        front: [],
        back: [],
        change: 'removes' as const,
        reps: card.reps,
      })),
    ];
  })();

  const removal = note
    ? reconcileCards(
        cards.map((card) => ({ direction: card.direction, slot: card.slot, reps: card.reps })),
        pendingType ?? noteType,
        fields as NoteFields,
        settings.ladder,
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

  useEffect(() => {
    if (!note || save !== 'dirty') {
      return;
    }

    const timer = setTimeout(() => {
      setSave('saving');

      update({
        id: note.id,
        fields,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ''),
      })
        .then(() => setSave('saved'))
        .catch(() => setSave('failed'));
    }, 700);

    return () => clearTimeout(timer);
  }, [save, note, fields, tags, update]);

  function edit(next: Record<string, unknown>) {
    setFields(next);
    setSave(note ? 'dirty' : 'clean');
  }

  async function create() {
    if (deck === '') {
      return;
    }

    setSave('saving');

    try {
      const written = await actions.create.mutateAsync({
        // Generated here, so a retry after a timeout that actually landed does
        // not write the note twice.
        id: uuidV7(),
        deckId: deck,
        noteType,
        fields,
        tags: tagList,
      });

      setSave('saved');
      await navigate({ to: '/notes/$noteId', params: { noteId: written.note.id } });
    } catch {
      setSave('failed');
    }
  }

  /** Changing the type, once whatever it costs has been agreed to. */
  async function applyType(next: NoteTypeName, discard: boolean) {
    setPendingType(undefined);
    setNoteType(next);

    if (!note) {
      return;
    }

    setSave('saving');

    try {
      await actions.update.mutateAsync({
        id: note.id,
        noteType: next,
        fields,
        ...(discard ? { discardCards: true } : {}),
      });
      setSave('saved');
    } catch {
      setSave('failed');
    }
  }

  function chooseType(next: NoteTypeName) {
    if (next === noteType) {
      return;
    }

    const cost = note
      ? reconcileCards(
          cards.map((card) => ({ direction: card.direction, slot: card.slot, reps: card.reps })),
          next,
          fields as NoteFields,
          settings.ladder,
        )
      : undefined;

    if (cost && cost.reviewsLost > 0) {
      setPendingType(next);

      return;
    }

    void applyType(next, false);
  }

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <header className="flex items-center justify-between gap-12">
        <h1 className="font-display text-24 tracking-tight text-primary">
          {note ? t('note.edit') : t('note.new')}
        </h1>

        <div className="flex items-center gap-8">
          <SaveIndicator state={save} onRetry={() => setSave('dirty')} />

          {note ? (
            <Menu label={t('note.edit')}>
              <MenuItem
                icon={<Check size={16} strokeWidth={1.5} />}
                onSelect={() =>
                  void actions.update.mutateAsync({
                    id: note.id,
                    status: (note.status === 'known' ? 'active' : 'known') as NoteStatus,
                  })
                }
              >
                {note.status === 'known' ? t('note.markActive') : t('note.markKnown')}
              </MenuItem>

              <MenuSeparator />

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

      <div className="flex flex-col gap-20">
        <FormField label={t('note.type')}>
          {() => (
            <Segmented
              label={t('note.type')}
              value={noteType}
              options={NOTE_TYPES.map((type) => ({
                value: type,
                label: t(`note.type.${type}` as MessageKey),
              }))}
              onChange={chooseType}
            />
          )}
        </FormField>

        <FormField
          label={t('note.deck')}
          {...(deck === '' ? { error: t('note.missingDeck') } : {})}
        >
          {(props) => (
            <Select
              {...props}
              value={deck}
              disabled={note !== undefined}
              onChange={(event) => setDeck(event.target.value)}
            >
              {flatten(decks).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {'— '.repeat(entry.path.length) + entry.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {sections.map((section) => (
          <div key={section.name} className="flex flex-col gap-16">
            {section.labelKey ? <GroupLabel>{t(section.labelKey)}</GroupLabel> : undefined}

            {section.fields.map((field) => (
              <NoteField
                key={field.path}
                field={field}
                value={readField(fields, field.path)}
                onChange={(value) => edit(writeField(fields, field.path, value))}
              />
            ))}
          </div>
        ))}

        <FormField label={t('note.tags')} hint={t('note.tagsHint')}>
          {(props) => (
            <Input
              {...props}
              value={tags}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(event) => {
                setTags(event.target.value);
                setSave(note ? 'dirty' : 'clean');
              }}
            />
          )}
        </FormField>
      </div>

      <CardPreview cards={preview} />

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

      {pendingType && removal ? (
        <Dialog
          open
          onOpenChange={() => setPendingType(undefined)}
          title={t('note.typeChangeTitle')}
          description={t('note.typeChangeBody', {
            cards: removal.remove.length,
            reviews: removal.reviewsLost,
          })}
        >
          <DialogFooter>
            <Button variant="destructive" full onClick={() => void applyType(pendingType, true)}>
              {t('note.typeChangeSubmit')}
            </Button>
            <Button variant="text" full onClick={() => setPendingType(undefined)}>
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

  return (
    <FormField
      label={t(field.labelKey)}
      {...(field.hintKey === undefined ? {} : { hint: t(field.hintKey) })}
    >
      {(props) => {
        if (field.kind === 'toggle') {
          return (
            <span className="flex min-h-44 items-center">
              <Switch
                id={props.id}
                label={t(field.labelKey)}
                checked={value === true}
                onChange={onChange}
              />
            </span>
          );
        }

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

  if (state === 'clean') {
    return undefined;
  }

  if (state === 'failed') {
    return (
      <button type="button" onClick={onRetry} className="min-h-44 text-13 text-error">
        {t('note.saveFailed')}. {t('note.saveRetry')}
      </button>
    );
  }

  return (
    <span
      role="status"
      className={`text-13 ${state === 'saved' ? 'text-tertiary' : 'text-secondary'}`}
    >
      {state === 'saving'
        ? t('note.saving')
        : state === 'saved'
          ? t('note.saved')
          : t('note.saveNeeded')}
    </span>
  );
}
