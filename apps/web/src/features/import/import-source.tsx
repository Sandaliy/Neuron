import { Check } from 'lucide-react';
import { useState } from 'react';

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
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { TextArea } from '../../ui/textarea';
import { CollectionPicker } from '../library/collection-picker';
import { CardPreview } from '../notes/card-preview';

export type ImportMode = 'simple' | 'table' | 'json' | 'file';

export function fieldLabelKey(field: string): MessageKey {
  if (field === 'tags') return 'note.tags';
  if (field === 'rank') return 'notes.sort.rank';
  return `note.field.${field.replace('grammar.', '')}` as MessageKey;
}

export function ImportSource({
  decks,
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
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [fileError, setFileError] = useState(false);
  const [appendError, setAppendError] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [confirmExample, setConfirmExample] = useState(false);
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
      <FormField
        label={t('import.deck')}
        {...(deck === '' ? { error: t('note.missingDeck') } : {})}
      >
        {(props) => <CollectionPicker {...props} tree={decks} value={deck} onChange={onDeck} />}
      </FormField>
      <div
        className="grid grid-cols-2 gap-8 sm:grid-cols-4"
        role="group"
        aria-label={t('import.mode')}
      >
        {(['simple', 'table', 'json', 'file'] as const).map((value) => (
          <Button
            key={value}
            aria-pressed={mode === value}
            variant={mode === value ? 'quiet' : 'text'}
            className={mode === value ? 'ring-2 ring-inset ring-accent font-semibold' : ''}
            onClick={() => {
              onMode(value);
              onFormat(value === 'json' ? 'json' : '');
            }}
          >
            {mode === value && <Check size={16} aria-hidden="true" />}
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
        <div className="flex flex-col gap-12 rounded-12 border p-16">
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
          label={t('import.chooseFile')}
          hint={t('import.fileSupport')}
          error={fileError ? t('import.fileError') : undefined}
        >
          {(props) => (
            <input
              {...props}
              type="file"
              accept=".json,.csv,.tsv,.txt,text/plain"
              className="min-h-44 max-w-full text-16"
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
          )}
        </FormField>
      )}
      {fileName && mode === 'file' && (
        <p role="status" className="text-14 text-secondary">
          {fileName}
        </p>
      )}
      <FormField label={t('import.paste')} hint={t('import.previewHint')}>
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
      <details className="rounded-12 border p-16">
        <summary className="min-h-44 cursor-pointer text-14 text-primary">
          {t('import.example')}
        </summary>
        <pre className="overflow-x-auto py-12 text-13 text-secondary">{example}</pre>
        <CardPreview cards={exampleCards.map((card) => ({ ...card, change: 'adds' }))} />
        <Button
          onClick={() => {
            if (raw.trim()) setConfirmExample(true);
            else insertExample();
          }}
        >
          {t('import.useExample')}
        </Button>
      </details>
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
      <details className="rounded-12 border p-16">
        <summary className="min-h-44 cursor-pointer text-14 text-primary">
          {t('import.supportedFields')}
        </summary>
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
          {[
            'article',
            'plural',
            'gender',
            'praeteritum',
            'partizip2',
            'auxiliary',
            'separable',
            'case',
            'reflexive',
            'comparative',
            'superlative',
            'variant',
            'irregular',
            'uncountable',
          ].map((field) => (
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
      </details>
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
