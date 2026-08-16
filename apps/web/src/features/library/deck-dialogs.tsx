import { Check } from 'lucide-react';

import { CEFR_LEVELS, LANGUAGE_CODES } from '@neuron/shared';
import type { CefrLevel, DeckNode, DeckSettings, LanguageCode, MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { flatten, moveProblem, settingsFor } from '../../lib/decks';
import { useDialogState } from '../../lib/dialog-state';
import { Button } from '../../ui/button';
import { DIALOG_FORM, Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';

import type { FormEvent } from 'react';

/**
 * The four decisions a deck row can ask for.
 *
 * Each is a dialog rather than a screen, because each belongs to the row behind
 * it and has one answer. They all fit a 375 by 812 phone whole, with the
 * keyboard up, which `tests/dialogs.spec.ts` checks rather than trusts.
 */

/** Naming a deck, whether it is new or being renamed. */
export function DeckNameDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initialName = '',
  busy = false,
  error,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly submitLabel: string;
  readonly initialName?: string;
  readonly busy?: boolean;
  readonly error?: unknown;
  readonly onSubmit: (name: string) => void;
}) {
  const t = useTranslate();
  // Refilled every time the dialog opens, so reopening it does not offer
  // whatever was half typed the time before.
  const [name, setName] = useDialogState(open, initialName);

  function submit(event: FormEvent) {
    event.preventDefault();

    if (name.trim() !== '') {
      onSubmit(name.trim());
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className={DIALOG_FORM}>
        <DialogBody>
          <FormField
            label={t('library.deckName')}
            {...(error === undefined
              ? {}
              : { error: t(describe(error).key, describe(error).values) })}
          >
            {(props) => (
              <Input
                {...props}
                value={name}
                autoComplete="off"
                enterKeyHint="done"
                placeholder={t('library.deckNamePlaceholder')}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
        </DialogBody>

        <DialogFooter>
          <Button type="submit" variant="primary" full busy={busy} disabled={name.trim() === ''}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * Choosing where a deck goes.
 *
 * The primary way to move a deck, and on a phone the only one. Dragging on a
 * touch screen fights with scrolling and misfires, so the drag that exists is
 * an addition on pointer devices and this is what everybody gets.
 *
 * Every target is listed, and the ones that cannot work are disabled with the
 * reason next to them rather than left to be chosen and then refused. Moving a
 * deck into its own descendant is the case that matters: it is rejected here,
 * before a request is sent, and the server refuses it as well.
 */
export function MoveDeckDialog({
  open,
  onOpenChange,
  deck,
  decks,
  busy = false,
  onMove,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly deck: DeckNode;
  readonly decks: readonly DeckNode[];
  readonly busy?: boolean;
  readonly onMove: (parentId: string | null) => void;
}) {
  const t = useTranslate();
  const [target, setTarget] = useDialogState<string | null>(open, deck.parentId);

  const problems: Record<string, MessageKey> = {
    self: 'library.moveSelf',
    descendant: 'library.moveDescendant',
    same: 'library.moveSame',
  };

  const chosen = moveProblem(decks, deck.id, target);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library.moveTitle', { name: deck.name })}
    >
      <DialogBody className="gap-4">
        <TargetRow
          label={t('library.moveRoot')}
          depth={0}
          selected={target === null}
          {...(moveProblem(decks, deck.id, null) === undefined
            ? { onSelect: () => setTarget(null) }
            : {
                reason: t(
                  problems[moveProblem(decks, deck.id, null) ?? 'same'] ?? 'library.moveSame',
                ),
              })}
        />

        {flatten(decks).map((entry) => {
          const problem = moveProblem(decks, deck.id, entry.id);

          return (
            <TargetRow
              key={entry.id}
              label={entry.name}
              depth={entry.path.length + 1}
              selected={target === entry.id}
              {...(problem === undefined
                ? { onSelect: () => setTarget(entry.id) }
                : { reason: t(problems[problem] ?? 'library.moveSame') })}
            />
          );
        })}
      </DialogBody>

      <DialogFooter>
        <Button
          variant="primary"
          full
          busy={busy}
          disabled={chosen !== undefined}
          onClick={() => onMove(target)}
        >
          {t('library.moveSubmit')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** One possible home for a deck, at its depth in the tree. */
function TargetRow({
  label,
  depth,
  selected,
  reason,
  onSelect,
}: {
  readonly label: string;
  readonly depth: number;
  readonly selected: boolean;
  /** Why this one cannot be chosen. Present means it is disabled. */
  readonly reason?: string;
  readonly onSelect?: () => void;
}) {
  const disabled = onSelect === undefined;

  return (
    <button
      type="button"
      data-row=""
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      style={{ paddingLeft: `${12 + Math.min(depth, 4) * 16}px` }}
      className={[
        'flex min-h-44 w-full items-center gap-8 rounded-12 py-8 pr-12 text-left',
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-raised',
        selected ? 'bg-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-14 text-primary">{label}</span>
        {reason ? <span className="truncate text-12 text-tertiary">{reason}</span> : undefined}
      </span>

      {selected ? (
        <Check size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-accent" />
      ) : undefined}
    </button>
  );
}

/**
 * What a deck is about: two languages and a level.
 *
 * These feed the card generation prompt and decide which grammar fields a word
 * is asked for, and they inherit, so they are set once on the German folder and
 * every lesson inside it follows. A field left alone says what it inherited
 * rather than sitting empty, because "not set" and "set to the same thing as
 * the parent" behave identically and look completely different.
 */
export function DeckSettingsDialog({
  open,
  onOpenChange,
  deck,
  decks,
  busy = false,
  onSave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly deck: DeckNode;
  readonly decks: readonly DeckNode[];
  readonly busy?: boolean;
  readonly onSave: (settings: DeckSettings) => void;
}) {
  const t = useTranslate();
  const [draft, setDraft] = useDialogState<DeckSettings>(
    open,
    (deck.settings ?? {}) as DeckSettings,
  );

  // What the deck would resolve to with nothing of its own, which is what an
  // empty field is actually going to behave as.
  const inherited = settingsFor(
    decks.map((entry) => stripOwn(entry, deck.id)),
    deck.id,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('library.settings')}
      description={t('library.settingsSubtitle')}
    >
      <DialogBody>
        <LanguageField
          label={t('library.targetLanguage')}
          value={draft.targetLanguage}
          inherited={inherited.targetLanguage}
          onChange={(value) => setDraft({ ...draft, targetLanguage: value })}
        />

        <LanguageField
          label={t('library.nativeLanguage')}
          value={draft.nativeLanguage}
          inherited={inherited.nativeLanguage}
          onChange={(value) => setDraft({ ...draft, nativeLanguage: value })}
        />

        <FormField
          label={t('library.level')}
          {...(inherited.level === undefined
            ? {}
            : { hint: t('library.inherited', { value: inherited.level }) })}
        >
          {(props) => (
            <Select
              {...props}
              value={draft.level ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  ...(event.target.value === ''
                    ? { level: undefined }
                    : { level: event.target.value as CefrLevel }),
                })
              }
            >
              <option value="">{t('library.notSet')}</option>
              {CEFR_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </DialogBody>

      <DialogFooter>
        <Button variant="primary" full busy={busy} onClick={() => onSave(draft)}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function LanguageField({
  label,
  value,
  inherited,
  onChange,
}: {
  readonly label: string;
  readonly value: LanguageCode | undefined;
  readonly inherited: LanguageCode | undefined;
  readonly onChange: (value: LanguageCode | undefined) => void;
}) {
  const t = useTranslate();

  return (
    <FormField
      label={label}
      {...(inherited === undefined
        ? {}
        : { hint: t('library.inherited', { value: t(`lang.${inherited}` as MessageKey) }) })}
    >
      {(props) => (
        <Select
          {...props}
          value={value ?? ''}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : (event.target.value as LanguageCode))
          }
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
  );
}

/** The tree with one deck's own settings taken off, to see what it inherits. */
function stripOwn(deck: DeckNode, id: string): DeckNode {
  return {
    ...deck,
    ...(deck.id === id ? { settings: null } : {}),
    children: deck.children.map((child) => stripOwn(child, id)),
  };
}
