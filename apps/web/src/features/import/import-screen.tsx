import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import {
  IMPORT_FIELDS,
  IMPORT_CHUNK_SIZE,
  IMPORT_FORMATS,
  NOTE_TYPES,
  detectFormat,
  noteTermKey,
  parseImport,
  rowProblems,
  termCounts,
  termOf,
  uuidV7,
} from '@neuron/shared';
import type {
  DeckNode,
  DuplicateMatch,
  ImportFormat,
  MessageKey,
  NoteTypeName,
  ParseResult,
  ParsedRow,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { findDeck, flatten, useDeckTree } from '../../lib/decks';
import { findDuplicates } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Card, GroupLabel, Panel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { Dialog, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Progress } from '../../ui/progress';
import { Select } from '../../ui/select';
import { ErrorState } from '../../ui/states';
import { TextArea } from '../../ui/textarea';
import { useToast } from '../../ui/toast';

/** What to do about a word the library already has. */
type Resolution = 'skip' | 'merge' | 'create';

/** Where the screen is. Each step only exists once the one before it is done. */
type Stage =
  | { readonly kind: 'source' }
  | { readonly kind: 'preview'; readonly parsed: ParseResult }
  | {
      readonly kind: 'importing';
      readonly batchId: string;
      readonly done: number;
      readonly total: number;
      readonly failed?: boolean;
    }
  | {
      readonly kind: 'done';
      readonly batchId: string;
      readonly notes: number;
      readonly cards: number;
    };

/**
 * Bringing a word list in.
 *
 * Four steps, and the third one is the reason the other three exist: nothing is
 * written until the whole list has been shown as rows, with what is wrong with
 * each of them. Five thousand generated cards are cheap to make and expensive
 * to pick back out of a deck by hand.
 *
 * The upload is chunked. Five hundred rows a request, each note carrying an id
 * this screen generated, so a chunk that was sent twice writes nothing the
 * second time and a connection that dropped can be carried on from where it
 * stopped rather than started again.
 */
export function ImportScreen({ deckId }: { readonly deckId?: string }) {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const decks = useDeckTree();

  const [deck, setDeck] = useState(deckId ?? '');
  const [raw, setRaw] = useState('');
  const [format, setFormat] = useState<ImportFormat | ''>('');
  const [noteType, setNoteType] = useState<NoteTypeName>('vocab');
  const [columns, setColumns] = useState<readonly string[]>([]);
  const [stage, setStage] = useState<Stage>({ kind: 'source' });
  const [duplicates, setDuplicates] = useState<readonly DuplicateMatch[]>([]);
  const [resolution, setResolution] = useState<Resolution>('skip');
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const [confirmUndo, setConfirmUndo] = useState<
    { readonly notes: number; readonly reviewedCards: number } | undefined
  >();

  const tree = decks.data ?? [];
  const chosenFormat = format === '' ? detectFormat(raw) : format;

  /** Reads the file, then asks the server which of its words are already here. */
  async function read() {
    setFailure(undefined);

    const parsed = parseImport(raw, chosenFormat, {
      noteType,
      ...(columns.length > 0 ? { columns } : {}),
    });

    setStage({ kind: 'preview', parsed });
    setColumns(parsed.columns ?? []);
    setChecking(true);

    try {
      const terms = parsed.rows.map((row) => termOf(row.fields)).filter((term) => term !== '');

      setDuplicates(await findDuplicates(terms));
    } catch (error) {
      // The list is still worth showing. A duplicate check that did not answer
      // means the duplicates are not marked, not that the import cannot happen.
      setFailure(error);
      setDuplicates([]);
    } finally {
      setChecking(false);
    }
  }

  /**
   * Sends the list, a chunk at a time.
   *
   * @param from which chunk to start at, so a failure can be carried on from
   */
  async function upload(parsed: ParseResult, batchId: string, from = 0) {
    const plan = planRows(parsed, duplicates, resolution);
    const chunks: (typeof plan.create)[] = [];

    for (let start = 0; start < plan.create.length; start += IMPORT_CHUNK_SIZE) {
      chunks.push(plan.create.slice(start, start + IMPORT_CHUNK_SIZE));
    }

    setStage({ kind: 'importing', batchId, done: from, total: chunks.length });

    try {
      if (from === 0) {
        await request('/imports', {
          method: 'POST',
          body: {
            id: batchId,
            deckId: deck,
            source: parsed.source ?? sourceName(parsed.format),
            format: parsed.format,
          },
        });
      }

      for (let index = from; index < chunks.length; index += 1) {
        await request(`/imports/${batchId}/notes`, {
          method: 'POST',
          body: {
            notes: (chunks[index] ?? []).map((row) => ({
              id: row.id,
              noteType: parsed.noteType,
              fields: row.fields,
              tags: row.tags,
              ...(row.rank === undefined ? {} : { rank: row.rank }),
            })),
          },
        });

        setStage({ kind: 'importing', batchId, done: index + 1, total: chunks.length });
      }

      // Merges are one request each, and there are usually few. They fill in
      // only what is empty on the note that is already there, so a note being
      // reviewed keeps every word of it.
      for (const merge of plan.merge) {
        await request(`/notes/${merge.noteId}`, {
          method: 'PATCH',
          body: { fields: merge.fields },
        });
      }

      const summary = await request<{ notes: number; cards: number }>(`/imports/${batchId}`);

      setStage({ kind: 'done', batchId, notes: summary.notes, cards: summary.cards });
    } catch (error) {
      setFailure(error);
      setStage((current) =>
        current.kind === 'importing' ? { ...current, failed: true } : current,
      );
    }
  }

  async function undo(batchId: string) {
    await request(`/imports/${batchId}/undo`, { method: 'POST' });

    setConfirmUndo(undefined);
    toast.show(t('import.undone'));
    setStage({ kind: 'source' });
    setRaw('');
  }

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <header className="flex items-center justify-between gap-12">
        <h1 className="font-display text-24 tracking-tight text-primary">{t('import.title')}</h1>
      </header>

      {stage.kind === 'source' ? (
        <Source
          decks={tree}
          deck={deck}
          raw={raw}
          format={chosenFormat}
          noteType={noteType}
          onDeck={setDeck}
          onRaw={setRaw}
          onFormat={setFormat}
          onNoteType={setNoteType}
          onRead={() => void read()}
        />
      ) : undefined}

      {stage.kind === 'preview' ? (
        <Preview
          parsed={stage.parsed}
          duplicates={duplicates}
          resolution={resolution}
          checking={checking}
          columns={columns}
          onColumns={(next) => {
            setColumns(next);
            setStage({
              kind: 'preview',
              parsed: parseImport(raw, chosenFormat, { noteType, columns: next }),
            });
          }}
          onResolution={setResolution}
          onBack={() => setStage({ kind: 'source' })}
          onStart={() => void upload(stage.parsed, uuidV7())}
        />
      ) : undefined}

      {stage.kind === 'importing' ? (
        <Card className="flex flex-col gap-16">
          <p className="text-15 text-primary">{t('import.importing')}</p>

          <Progress
            value={stage.total === 0 ? 1 : stage.done / stage.total}
            label={t('import.importing')}
          />

          <p className="text-13 text-tertiary" data-numeric="">
            {t('import.progress', { done: stage.done, total: stage.total })}
          </p>

          {stage.failed ? (
            <>
              <p className="text-14 leading-body text-error">
                {t('import.failed', { done: stage.done, total: stage.total })}
              </p>
              <Button
                variant="primary"
                onClick={() => {
                  const parsed = parseImport(raw, chosenFormat, { noteType, columns });

                  void upload(parsed, stage.batchId, stage.done);
                }}
              >
                {t('import.resume')}
              </Button>
            </>
          ) : undefined}
        </Card>
      ) : undefined}

      {stage.kind === 'done' ? (
        <Card className="flex flex-col items-start gap-16">
          <p className="text-17 text-primary">{t('import.doneTitle')}</p>
          <p className="text-14 leading-body text-secondary" data-numeric="">
            {t('import.doneBody', { notes: stage.notes, cards: stage.cards })}
          </p>

          {/* The triage sweep lands here in phase 9. */}
          <p className="text-13 text-tertiary">{t('import.triageLater')}</p>

          <div className="flex flex-wrap gap-8">
            <Button
              variant="primary"
              onClick={() =>
                void navigate({
                  to: '/notes',
                  search: deck === '' ? {} : { deckId: deck },
                })
              }
            >
              {t('import.openDeck')}
            </Button>

            <Button
              variant="destructive"
              onClick={async () => {
                const summary = await request<{ notes: number; reviewedCards: number }>(
                  `/imports/${stage.batchId}`,
                );

                setConfirmUndo(summary);
              }}
            >
              {t('import.undo')}
            </Button>
          </div>
        </Card>
      ) : undefined}

      {failure && stage.kind !== 'importing' ? (
        <ErrorState
          message={t(describe(failure).key, describe(failure).values)}
          retryLabel={t('common.retry')}
        />
      ) : undefined}

      {confirmUndo && stage.kind === 'done' ? (
        <Dialog
          open
          onOpenChange={() => setConfirmUndo(undefined)}
          title={t('import.undoTitle', { count: confirmUndo.notes })}
          description={t('import.undoBody')}
        >
          <DialogFooter>
            {/*
              The second confirmation, and only when there is something to lose.
              Answers cannot be recreated by importing the file again, which is
              exactly what makes them worth stopping for.
            */}
            {confirmUndo.reviewedCards > 0 ? (
              <p className="text-14 leading-body text-error">
                {t('import.undoReviewed', { count: confirmUndo.reviewedCards })}
              </p>
            ) : undefined}

            <Button variant="destructive" full onClick={() => void undo(stage.batchId)}>
              {confirmUndo.reviewedCards > 0 ? t('import.undoConfirm') : t('import.undo')}
            </Button>
            <Button variant="text" full onClick={() => setConfirmUndo(undefined)}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : undefined}
    </section>
  );
}

/** What the import will be called, when the file did not say. */
function sourceName(format: ImportFormat): string {
  return `Imported ${format.toUpperCase()}`;
}

/** A row on its way in, with the id it will carry. */
interface PlannedRow extends ParsedRow {
  readonly id: string;
}

/**
 * What actually happens to each row, once the duplicates have been decided.
 *
 * @param parsed the file as it was read
 * @param duplicates what the library already has
 * @param resolution what to do about those
 * @returns the rows to create and the notes to fill in
 */
function planRows(
  parsed: ParseResult,
  duplicates: readonly DuplicateMatch[],
  resolution: Resolution,
): {
  create: PlannedRow[];
  merge: { noteId: string; fields: Record<string, unknown> }[];
  skipped: number;
} {
  const known = new Map(duplicates.map((match) => [match.term, match]));
  const counts = termCounts(parsed.rows);
  const seen = new Set<string>();

  const create: PlannedRow[] = [];
  const merge: { noteId: string; fields: Record<string, unknown> }[] = [];
  let skipped = 0;

  for (const row of parsed.rows) {
    const problems = rowProblems(row, parsed.noteType, counts);

    // A row the type would refuse is never sent. The server would reject the
    // whole chunk for it, which would take four hundred good rows with it.
    if (problems.missing.length > 0) {
      skipped += 1;

      continue;
    }

    const key = noteTermKey(row.fields);

    // The second copy of a word inside one file is always skipped. Importing a
    // list that repeats itself should not put the same word in twice.
    if (key !== '' && seen.has(key)) {
      skipped += 1;

      continue;
    }

    seen.add(key);

    const match = key === '' ? undefined : known.get(key);

    if (match === undefined || resolution === 'create') {
      create.push({ ...row, id: uuidV7() });

      continue;
    }

    if (resolution === 'skip') {
      skipped += 1;

      continue;
    }

    merge.push({ noteId: match.noteId, fields: row.fields });
  }

  return { create, merge, skipped };
}

function Source({
  decks,
  deck,
  raw,
  format,
  noteType,
  onDeck,
  onRaw,
  onFormat,
  onNoteType,
  onRead,
}: {
  readonly decks: readonly DeckNode[];
  readonly deck: string;
  readonly raw: string;
  readonly format: ImportFormat;
  readonly noteType: NoteTypeName;
  readonly onDeck: (value: string) => void;
  readonly onRaw: (value: string) => void;
  readonly onFormat: (value: ImportFormat | '') => void;
  readonly onNoteType: (value: NoteTypeName) => void;
  readonly onRead: () => void;
}) {
  const t = useTranslate();

  return (
    <div className="flex flex-col gap-20">
      <p className="text-14 leading-body text-secondary">{t('import.subtitle')}</p>

      <FormField
        label={t('import.deck')}
        {...(deck === '' ? { error: t('note.missingDeck') } : {})}
      >
        {(props) => (
          <Select {...props} value={deck} onChange={(event) => onDeck(event.target.value)}>
            <option value="">{t('library.notSet')}</option>
            {flatten(decks).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {'— '.repeat(entry.path.length) + entry.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField label={t('import.paste')}>
        {(props) => (
          <TextArea
            {...props}
            value={raw}
            rows={8}
            spellCheck={false}
            onChange={(event) => onRaw(event.target.value)}
          />
        )}
      </FormField>

      <label className="flex min-h-44 items-center gap-12 text-14 text-accent">
        <input
          type="file"
          accept=".json,.csv,.tsv,.txt,text/plain"
          className="max-w-full text-14 text-secondary file:mr-12 file:min-h-44 file:rounded-12 file:border-0 file:bg-fill-neutral file:px-16 file:text-14 file:text-primary"
          onChange={async (event) => {
            const file = event.target.files?.[0];

            if (file) {
              onRaw(await file.text());
              onFormat('');
            }
          }}
        />
      </label>

      <div className="grid gap-12 sm:grid-cols-2">
        <FormField label={t('import.format')}>
          {(props) => (
            <Select
              {...props}
              value={format}
              onChange={(event) => onFormat(event.target.value as ImportFormat)}
            >
              {IMPORT_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {t(`import.format.${option}` as MessageKey)}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label={t('import.noteType')}>
          {(props) => (
            <Select
              {...props}
              value={noteType}
              onChange={(event) => onNoteType(event.target.value as NoteTypeName)}
            >
              {NOTE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {t(`note.type.${option}` as MessageKey)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <Button variant="primary" full disabled={raw.trim() === '' || deck === ''} onClick={onRead}>
        {t('import.read')}
      </Button>
    </div>
  );
}

/** The table: every row, and what is wrong with it. */
function Preview({
  parsed,
  duplicates,
  resolution,
  checking,
  columns,
  onColumns,
  onResolution,
  onBack,
  onStart,
}: {
  readonly parsed: ParseResult;
  readonly duplicates: readonly DuplicateMatch[];
  readonly resolution: Resolution;
  readonly checking: boolean;
  readonly columns: readonly string[];
  readonly onColumns: (columns: readonly string[]) => void;
  readonly onResolution: (value: Resolution) => void;
  readonly onBack: () => void;
  readonly onStart: () => void;
}) {
  const t = useTranslate();
  const decks = useDeckTree();
  const counts = termCounts(parsed.rows);
  const known = new Map(duplicates.map((match) => [match.term, match]));
  const plan = planRows(parsed, duplicates, resolution);

  const problems = parsed.rows.filter((row) => {
    const found = rowProblems(row, parsed.noteType, counts);

    return found.missing.length > 0 || found.exampleMisses || found.duplicateInFile;
  });

  // Only the first two hundred are drawn. The counts above them are over the
  // whole list, and nobody reads five thousand rows to decide.
  const shown = parsed.rows.slice(0, 200);

  return (
    <div className="flex flex-col gap-20">
      {parsed.columns && (parsed.format === 'csv' || parsed.format === 'tsv') ? (
        <div className="flex flex-col gap-8">
          <GroupLabel>{t('import.columns')}</GroupLabel>

          <div className="grid gap-8 sm:grid-cols-3">
            {columns.map((column, index) => (
              <Select
                key={index}
                value={column}
                aria-label={t('import.columns')}
                onChange={(event) => {
                  const next = [...columns];

                  next[index] = event.target.value;
                  onColumns(next);
                }}
              >
                <option value="">{t('import.columnIgnored')}</option>
                {IMPORT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        </div>
      ) : undefined}

      <Panel className="flex flex-col gap-8">
        <p className="text-14 text-primary" data-numeric="">
          {t('import.previewCount', { count: parsed.rows.length })}
        </p>
        <p className="text-13 text-secondary" data-numeric="">
          {t('import.willCreate', { count: plan.create.length })} ·{' '}
          {t('import.willSkip', { count: plan.skipped })} ·{' '}
          {t('import.willMerge', { count: plan.merge.length })}
        </p>
        {problems.length > 0 ? (
          <p className="text-13 text-secondary" data-numeric="">
            {t('import.rowsWithProblems', { count: problems.length })}
          </p>
        ) : undefined}
        {parsed.failures.length > 0 ? (
          <p className="text-13 text-error">{parsed.failures[0]?.reason}</p>
        ) : undefined}
      </Panel>

      {checking ? (
        <p className="text-13 text-tertiary">{t('import.checking')}</p>
      ) : duplicates.length > 0 ? (
        <FormField
          label={t('import.duplicateAll')}
          hint={t('import.duplicatesFound', { count: duplicates.length })}
        >
          {(props) => (
            <Select
              {...props}
              value={resolution}
              onChange={(event) => onResolution(event.target.value as Resolution)}
            >
              {(['skip', 'merge', 'create'] as const).map((option) => (
                <option key={option} value={option}>
                  {t(`import.resolve.${option}` as MessageKey)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : undefined}

      <div className="flex flex-col gap-4">
        <GroupLabel>{t('import.preview')}</GroupLabel>

        <div data-g="card" data-rows="" className="flex flex-col overflow-hidden rounded-24 border">
          {shown.map((row) => (
            <PreviewRow
              key={row.line}
              row={row}
              noteType={parsed.noteType}
              counts={counts}
              {...(known.get(noteTermKey(row.fields)) === undefined
                ? {}
                : {
                    duplicateIn:
                      findDeck(decks.data ?? [], known.get(noteTermKey(row.fields))?.deckId ?? '')
                        ?.name ?? '',
                  })}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-12">
        <Button
          variant="primary"
          full
          disabled={plan.create.length + plan.merge.length === 0}
          onClick={onStart}
        >
          {t('import.start', { count: plan.create.length + plan.merge.length })}
        </Button>
        <Button variant="text" full onClick={onBack}>
          {t('common.back')}
        </Button>
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  noteType,
  counts,
  duplicateIn,
}: {
  readonly row: ParsedRow;
  readonly noteType: NoteTypeName;
  readonly counts: ReadonlyMap<string, number>;
  readonly duplicateIn?: string;
}) {
  const t = useTranslate();
  const problems = rowProblems(row, noteType, counts);
  const meaning =
    typeof row.fields['translation'] === 'string'
      ? row.fields['translation']
      : typeof row.fields['back'] === 'string'
        ? row.fields['back']
        : '';

  const notes = [
    problems.missing.length > 0
      ? t('import.problemMissing', { fields: problems.missing.join(', ') })
      : undefined,
    problems.exampleMisses ? t('import.problemExample') : undefined,
    problems.duplicateInFile ? t('import.problemDuplicateFile') : undefined,
    duplicateIn === undefined ? undefined : t('import.problemDuplicate', { deck: duplicateIn }),
    row.issue === undefined ? undefined : t('import.problemIssue'),
  ].filter((note): note is string => note !== undefined);

  return (
    <div className="flex min-h-52 items-center gap-12 px-16 py-8">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-14 text-primary">{termOf(row.fields)}</span>
        <span className="truncate text-12 text-tertiary">{meaning}</span>
      </span>

      {notes.length > 0 ? (
        <span className="flex shrink-0 flex-col items-end gap-4">
          {notes.slice(0, 2).map((note) => (
            <Chip key={note} tone={problems.missing.length > 0 ? 'slipping' : 'plain'}>
              {note}
            </Chip>
          ))}
        </span>
      ) : undefined}
    </div>
  );
}
