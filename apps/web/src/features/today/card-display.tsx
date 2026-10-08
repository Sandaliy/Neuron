import { PRACTICE_FIELDS, practiceFieldLabel, practiceValue } from '@neuron/shared';
import type { Note, PlannedCard, MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { Checkbox } from '../../ui/checkbox';
import { Select } from '../../ui/select';

import { Speaker } from './listening-prompt';

export const SUPPORT_FIELDS = [
  'translation',
  'definition',
  'example',
  'exampleTranslation',
  'grammar',
  'pattern',
  'mnemonic',
  'note',
] as const;
type SupportField = (typeof SUPPORT_FIELDS)[number];
export interface CardDisplay {
  readonly meaning: 'translation' | 'definition';
  readonly support: readonly SupportField[];
}
export const DEFAULT_CARD_DISPLAY: CardDisplay = {
  meaning: 'translation',
  support: [...SUPPORT_FIELDS],
};
const label = (field: SupportField): MessageKey =>
  field === 'grammar'
    ? 'note.section.grammar'
    : field === 'pattern'
      ? 'study.pattern'
      : (`note.field.${field}` as MessageKey);

export function populatedSupport(note: Note, field: SupportField): boolean {
  if (field === 'pattern') return practiceValue(note.fields, 'grammar.pattern') !== undefined;
  if (field === 'grammar')
    return PRACTICE_FIELDS.some(
      (key) =>
        key.startsWith('grammar.') &&
        key !== 'grammar.pattern' &&
        practiceValue(note.fields, key) !== undefined,
    );
  const value = note.fields[field];
  return typeof value === 'string' && !!value.trim();
}

/** Presentation choices cannot change the direction, slot or expected typed answer. */
export function displayedFace(note: Note, face: PlannedCard, display: CardDisplay): PlannedCard {
  if (
    note.noteType !== 'vocab' ||
    display.meaning !== 'definition' ||
    !populatedSupport(note, 'definition')
  )
    return face;
  const replaceMeaning = (lines: PlannedCard['front']) =>
    lines.map((line) =>
      line.field === 'translation'
        ? { field: 'definition', value: String(note.fields['definition']) }
        : line,
    );
  return { ...face, front: replaceMeaning(face.front), back: replaceMeaning(face.back) };
}

export function CardDisplaySetup({
  notes,
  value,
  onChange,
}: {
  readonly notes: readonly Note[];
  readonly value: CardDisplay;
  readonly onChange: (value: CardDisplay) => void;
}) {
  const t = useTranslate();
  const available = SUPPORT_FIELDS.filter((field) =>
    notes.some((note) => populatedSupport(note, field)),
  );
  if (!available.length) return null;
  return (
    <fieldset className="flex flex-col gap-8 border-t border-subtle pt-12">
      <legend className="text-13 text-primary">{t('study.cardDisplay')}</legend>
      {available.includes('definition') && (
        <label className="flex items-center justify-between gap-12 text-13 text-secondary">
          {t('study.meaningSource')}
          <Select
            value={value.meaning}
            onChange={(event) =>
              onChange({ ...value, meaning: event.target.value as CardDisplay['meaning'] })
            }
          >
            <option value="translation">{t('note.field.translation')}</option>
            <option value="definition">{t('note.field.definition')}</option>
          </Select>
        </label>
      )}
      <span className="text-13 text-secondary">{t('study.cardDisplayHint')}</span>
      <div className="grid grid-cols-1 min-[360px]:grid-cols-2">
        {available.map((field) => (
          <Checkbox
            key={field}
            checked={value.support.includes(field)}
            onChange={(checked) =>
              onChange({
                ...value,
                support: checked
                  ? [...value.support, field]
                  : value.support.filter((item) => item !== field),
              })
            }
          >
            {t(label(field))}
          </Checkbox>
        ))}
      </div>
    </fieldset>
  );
}

export function RevealedStudyContent({
  note,
  face,
  display,
  language,
  identity,
}: {
  readonly note: Note;
  readonly face: PlannedCard;
  readonly display: CardDisplay;
  readonly language: string | undefined;
  readonly identity: string;
}) {
  const t = useTranslate();
  const main = displayedFace(note, face, display).back;
  const primary = new Set(main.map((line) => line.field));
  return (
    <div className="flex flex-col gap-20">
      <div>
        {main.map((line) => (
          <div
            key={line.field}
            className={line.field === 'term' ? 'flex items-start gap-8' : 'whitespace-pre-line'}
          >
            <span className="min-w-0 whitespace-pre-line">{line.value}</span>
            {line.field === 'term' && (
              <Speaker key={identity} text={line.value} language={language} />
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-16 text-17 leading-read">
        {display.support
          .filter((field) => !primary.has(field) && populatedSupport(note, field))
          .map((field) => (
            <div key={field}>
              <p className="mb-4 text-12 text-secondary">{t(label(field))}</p>
              {field === 'grammar' ? (
                <dl className="flex flex-col gap-4">
                  {PRACTICE_FIELDS.filter(
                    (key) => key.startsWith('grammar.') && key !== 'grammar.pattern',
                  ).flatMap((key) => {
                    const value = practiceValue(note.fields, key);
                    if (value === undefined) return [];
                    const text =
                      typeof value === 'boolean'
                        ? t(value ? 'practice.yes' : 'practice.no')
                        : key === 'grammar.gender' && ['m', 'f', 'n'].includes(value)
                          ? t(`note.gender.${value}` as MessageKey)
                          : key === 'grammar.case' &&
                              ['accusative', 'dative', 'genitive'].includes(value)
                            ? t(`note.case.${value}` as MessageKey)
                            : key === 'grammar.countability'
                              ? t(`note.countability.${value}` as MessageKey)
                              : value;
                    return (
                      <div key={key} className="flex flex-wrap gap-x-8">
                        <dt className="text-secondary">{t(practiceFieldLabel(key))}</dt>
                        <dd className="whitespace-pre-line">{text}</dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="whitespace-pre-line">
                  {field === 'pattern'
                    ? practiceValue(note.fields, 'grammar.pattern')
                    : String(note.fields[field])}
                </p>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
