import { useRef, useState } from 'react';

import {
  IMPORT_FIELDS,
  NOTE_TYPES,
  noteFieldsSchemas,
  parseImport,
  detectFormat,
  openingCards,
} from '@neuron/shared';
import type { DeckNode, ImportFormat, MessageKey, NoteTypeName } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { settingsFor } from '../../lib/decks';
import { Button } from '../../ui/button';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { TextArea } from '../../ui/textarea';
import { CollectionPicker } from '../library/collection-picker';

export type ImportMode = 'simple' | 'table' | 'json' | 'file';

export function fieldLabelKey(field: string): MessageKey {
  if (field === 'tags') return 'note.tags';
  if (field === 'rank') return 'notes.sort.rank';
  return `note.field.${field.replace('grammar.', '')}` as MessageKey;
}

export function ImportSource({
  decks,
  scoped = false,
  deck,
  raw,
  noteType,
  mode,
  onMode,
  onDeck,
  onRaw,
  onFormat,
  onNoteType,
  onRead,
}: {
  readonly scoped?: boolean;
  readonly decks: readonly DeckNode[];
  readonly deck: string;
  readonly raw: string;
  readonly noteType: NoteTypeName;
  readonly mode: ImportMode;
  readonly onMode: (mode: ImportMode) => void;
  readonly onDeck: (value: string) => void;
  readonly onRaw: (value: string) => void;
  readonly onFormat: (value: ImportFormat | '') => void;
  readonly onNoteType: (value: NoteTypeName) => void;
  readonly onRead: () => void;
}) {
  const t = useTranslate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [fileError, setFileError] = useState(false);
  const [appendError, setAppendError] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [confirmExample, setConfirmExample] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const leftField = noteType === 'vocab' ? 'term' : noteType === 'basic' ? 'front' : 'text';
  const rightField = noteType === 'vocab' ? 'translation' : 'back';
  const exampleFields =
    noteType === 'cloze'
      ? { text: 'Ich {{lerne}} Deutsch.' }
      : noteType === 'basic'
        ? { front: 'Capital of France?', back: 'Paris' }
        : { term: 'lernen', translation: t('import.exampleMeaning') };
  const example =
    mode === 'json'
      ? JSON.stringify({ noteType, notes: [exampleFields] }, null, 2)
      : mode === 'table'
        ? Object.values(exampleFields).join('\t')
        : noteType === 'cloze'
          ? exampleFields.text
          : Object.values(exampleFields).join(' — ');
  const valid = noteFieldsSchemas[noteType].safeParse(exampleFields);
  const exampleCards = valid.success
    ? openingCards(noteType, valid.data, settingsFor(decks, deck).ladder)
    : [];

  function chooseFile() {
    const input = fileInput.current;
    if (!input) return;

    // `showPicker` keeps the browser's user-activation requirement explicit;
    // the click fallback covers Safari and older embedded browsers.
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  }

  function insertExample() {
    onRaw(example ?? '');
    onFormat(mode === 'json' ? 'json' : '');
    setConfirmExample(false);
  }

  function append() {
    const parsed = parseImport(raw, detectFormat(raw), { noteType });
    if (parsed.failures.length || parsed.noteType !== noteType) {
      setAppendError(true);
      return;
    }
    setAppendError(false);
    const simpleFields = parsed.rows.every(
      (row) =>
        row.tags.length === 0 &&
        row.rank === undefined &&
        Object.keys(row.fields).every(
          (key) => key === leftField || (noteType !== 'cloze' && key === rightField),
        ),
    );
    if (simpleFields && !/[\t\n]/.test(left + right)) {
      onRaw(
        [
          ...parsed.rows.map((row) =>
            noteType === 'cloze'
              ? String(row.fields[leftField] ?? '')
              : `${String(row.fields[leftField] ?? '')}\t${String(row.fields[rightField] ?? '')}`,
          ),
          noteType === 'cloze' ? left.trim() : `${left.trim()}\t${right.trim()}`,
        ].join('\n'),
      );
      onFormat(noteType === 'cloze' ? 'text' : 'tsv');
      setLeft('');
      setRight('');
      return;
    }
    onRaw(
      JSON.stringify(
        {
          noteType,
          notes: [
            ...parsed.rows.map((row) => ({ ...row.fields, tags: row.tags })),
            {
              [leftField]: left.trim(),
              ...(noteType === 'cloze' ? {} : { [rightField]: right.trim() }),
            },
          ],
        },
        null,
        2,
      ),
    );
    onFormat('json');
    setLeft('');
    setRight('');
  }

  return (
    <div className="flex flex-col gap-20">
      <p className="text-14 text-secondary">{t('import.subtitle')}</p>
      {scoped && deck ? (
        <Disclosure
          title={t('collection.changeDestination')}
          open={destinationOpen}
          onOpenChange={setDestinationOpen}
        >
          <FormField label={t('import.deck')}>
            {(props) => <CollectionPicker {...props} tree={decks} value={deck} onChange={onDeck} />}
          </FormField>
        </Disclosure>
      ) : (
        <>
          {' '}
          <FormField label={t('import.deck')}>
            {(props) => <CollectionPicker {...props} tree={decks} value={deck} onChange={onDeck} />}
          </FormField>
        </>
      )}
      <div className="grid grid-cols-2 gap-8" role="group" aria-label={t('import.mode')}>
        {(['simple', 'table', 'json', 'file'] as const).map((value) => (
          <Button
            key={value}
            aria-pressed={mode === value}
            variant="quiet"
            className={
              mode === value ? 'bg-selected border-strong text-primary font-semibold' : 'bg-sunken'
            }
            onClick={() => {
              onMode(value);
              onFormat(value === 'json' ? 'json' : '');
            }}
          >
            {t(`import.mode.${value}`)}
          </Button>
        ))}
      </div>
      <p className="text-14 text-secondary">{t(`import.help.${mode}`)}</p>
      <FormField label={t('import.noteType')}>
        {(props) => (
          <Select
            {...props}
            value={noteType}
            onChange={(event) => onNoteType(event.target.value as NoteTypeName)}
          >
            {NOTE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`note.type.${type}`)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {mode === 'simple' && (
        <div className="flex flex-col gap-12 rounded-12 border border-default p-16">
          <FormField label={t(fieldLabelKey(leftField))}>
            {(props) => (
              <Input {...props} value={left} onChange={(event) => setLeft(event.target.value)} />
            )}
          </FormField>
          {noteType !== 'cloze' && (
            <FormField label={t(fieldLabelKey(rightField))}>
              {(props) => (
                <Input
                  {...props}
                  value={right}
                  onChange={(event) => setRight(event.target.value)}
                />
              )}
            </FormField>
          )}
          <Button
            disabled={!left.trim() || (noteType !== 'cloze' && !right.trim())}
            onClick={append}
          >
            {t('import.addRow')}
          </Button>
          {appendError && (
            <p role="alert" className="text-14 text-error">
              {t('import.appendError')}
            </p>
          )}
        </div>
      )}
      {noteType === 'cloze' && <p className="text-14 text-secondary">{t('import.clozeHelp')}</p>}
      {mode === 'file' && (
        <FormField
          label={t('import.fileLabel')}
          hint={t('import.fileSupport')}
          error={fileError ? t('import.fileError') : undefined}
        >
          {(props) => (
            <>
              <Button onClick={chooseFile}>{t('import.chooseFile')}</Button>
              <p role="status" className="break-all text-14 text-secondary">
                {fileName || t('import.noFile')}
              </p>
              <input
                {...props}
                ref={fileInput}
                type="file"
                accept=".json,.csv,.tsv,.txt,text/plain"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setFileError(false);
                  setReading(true);
                  try {
                    if (!/\.(json|csv|tsv|txt)$/i.test(file.name) || file.size > 10 * 1024 * 1024)
                      throw new Error('unsupported file');
                    onRaw(await file.text());
                    onFormat('');
                    setFileName(file.name);
                  } catch {
                    setFileError(true);
                  } finally {
                    setReading(false);
                  }
                }}
              />
            </>
          )}
        </FormField>
      )}
      <FormField label={t('import.paste')}>
        {(props) => (
          <TextArea
            {...props}
            value={raw}
            rows={6}
            spellCheck={false}
            onChange={(event) => {
              onRaw(event.target.value);
              onFormat(mode === 'json' ? 'json' : '');
            }}
          />
        )}
      </FormField>
      <Disclosure
        title={t('import.example')}
        open={exampleOpen}
        onOpenChange={setExampleOpen}
        className="border-t border-subtle pt-8"
      >
        <pre className="overflow-x-auto py-12 text-13 text-secondary">{example}</pre>
        <table className="w-full table-fixed text-left text-13" aria-label={t('note.preview')}>
          <thead className="text-secondary">
            <tr>
              <th className="pb-8 font-normal">{t('study.skill')}</th>
              <th className="pb-8 font-normal">{t('note.previewFront')}</th>
              <th className="pb-8 font-normal">{t('note.previewBack')}</th>
            </tr>
          </thead>
          <tbody>
            {exampleCards.map((card) => (
              <tr
                key={`${card.direction}:${card.slot}`}
                className="border-t border-subtle align-top text-primary"
              >
                <th scope="row" className="py-12 pr-8 font-semibold">
                  {t(`card.direction.${card.direction}` as MessageKey)}
                </th>
                <td className="break-words py-12 pr-8">
                  {card.direction === 'listening'
                    ? t('import.spokenWord')
                    : card.front.map((line) => line.value).join(' · ')}
                </td>
                <td className="break-words py-12">
                  {card.back.map((line) => line.value).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {exampleCards.some((card) => card.direction === 'listening') && (
          <p className="py-8 text-13 text-secondary">{t('import.listeningExample')}</p>
        )}
        <Button
          onClick={() => {
            if (raw.trim()) setConfirmExample(true);
            else insertExample();
          }}
        >
          {t('import.useExample')}
        </Button>
      </Disclosure>
      <Dialog
        open={confirmExample}
        onOpenChange={setConfirmExample}
        title={t('import.replaceTitle')}
      >
        <DialogBody>
          <p className="text-14 text-secondary">{t('import.replaceBody')}</p>
        </DialogBody>
        <DialogFooter>
          <Button full variant="primary" onClick={insertExample}>
            {t('import.replaceConfirm')}
          </Button>
          <Button full variant="text" onClick={() => setConfirmExample(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </Dialog>
      <Disclosure
        title={t('import.supportedFields')}
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
        className="border-t border-subtle pt-8"
      >
        <ul className="flex flex-col gap-8 py-12 text-14 text-secondary">
          {(
            [
              'requiredVocab',
              'requiredBasic',
              'requiredCloze',
              'fieldNamesHelp',
              'extraFieldsHelp',
            ] as const
          ).map((key) => (
            <li key={key}>{t(`import.${key}`)}</li>
          ))}
        </ul>
        <dl className="grid grid-cols-2 gap-8 text-13">
          {IMPORT_FIELDS.map((field) => (
            <div key={field}>
              <dt className="text-primary">{t(fieldLabelKey(field))}</dt>
              <dd className="break-all font-mono text-secondary">{field}</dd>
            </div>
          ))}
        </dl>
        <p className="pt-12 text-14 text-secondary">{t('import.grammarFields')}</p>
        <ul className="grid grid-cols-2 gap-8 py-12 font-mono text-13 text-secondary">
          {Object.keys(noteFieldsSchemas.vocab.shape.grammar.unwrap().shape).map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
        <ul className="flex flex-col gap-8 py-12 text-14 text-secondary">
          {(['grammarBoolean', 'grammarValues', 'partOfSpeechHelp'] as const).map((key) => (
            <li key={key}>{t(`import.${key}`)}</li>
          ))}
        </ul>
        <pre className="overflow-x-auto text-13 text-secondary">
          {JSON.stringify(
            {
              noteType: 'vocab',
              notes: [
                {
                  term: 'Haus',
                  translation: t('import.exampleHouse'),
                  partOfSpeech: 'noun',
                  definition: 'A building to live in',
                  example: 'Das Haus ist groß.',
                  grammar: { article: 'das', plural: 'Häuser', gender: 'n' },
                  tags: ['A1'],
                  note: 'Plural: umlaut',
                },
              ],
            },
            null,
            2,
          )}
        </pre>
        <p className="py-12 text-14 text-secondary">{t('import.mediaLater')}</p>
      </Disclosure>
      <Button
        variant="primary"
        full
        busy={reading}
        disabled={!raw.trim() || !deck || fileError}
        onClick={onRead}
      >
        {t('import.read')}
      </Button>
    </div>
  );
}
