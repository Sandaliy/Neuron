import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  IMPORT_FIELDS,
  IMPORT_CHUNK_SIZE,
  detectFormat,
  noteTermKey,
  parseImport,
  noteFieldsSchemas,
  openingCards,
  termOf,
  PRACTICE_FIELDS,
  practiceFieldLabel,
  practiceValue,
} from '@neuron/shared';
import type {
  Note,
  DuplicateMatch,
  MessageKey,
  NoteTypeName,
  ParseResult,
  ParsedRow,
  RowProblems,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { ApiFailure, describe, request } from '../../lib/api';
import { hasServerAuthority, useCapabilities } from '../../lib/capabilities';
import { metadata, openCollection } from '../../lib/collection-db';
import { localNotes } from '../../lib/collection-read';
import { DECK_TREE_KEY, findDeck, settingsFor, useDeckTree } from '../../lib/decks';
import { findDuplicates, NOTE_KEY, noteQueryString } from '../../lib/notes';
import { accountEpoch, connectionEpoch, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { Card, GroupLabel, Panel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { Dialog, DialogFooter } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';
import { FormField } from '../../ui/form-field';
import { Progress } from '../../ui/progress';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { CollectionPath } from '../library/collection-path';
import { CardPreview } from '../notes/card-preview';

import { importDrafts, importDraftVisit, newImportDraft, saveImportDraft } from './import-drafts';
import {
  analyseImport,
  createAttempt,
  groupMatches,
  planRows,
  resolveDuplicate,
} from './import-plan';
import { ImportSource, fieldLabelKey } from './import-source';
import { PromptDialog } from './prompt-dialog';
import { useImportDraft } from './use-import-draft';

import type { ImportDraft } from './import-drafts';
import type { ImportAttempt, Overrides, Resolution } from './import-plan';

/** Where the screen is. Each step only exists once the one before it is done. */
type Stage =
  | { readonly kind: 'source' }
  | { readonly kind: 'preview'; readonly parsed: ParseResult }
  | {
      readonly kind: 'importing';
      readonly attempt: ImportAttempt;
      readonly batchId?: string;
      readonly done: number;
      readonly total: number;
      readonly merged: number;
      readonly phase: 'notes' | 'merges' | 'reconcile';
      readonly failed?: boolean;
    }
  | {
      readonly kind: 'done';
      /** Merges change an existing note and do not create an undoable batch. */
      readonly batchId?: string;
      readonly notes: number;
      readonly cards: number;
      readonly merged: number;
    };

/**
 * Bringing a word list in.
 *
 * Four steps, and the third one is the reason the other three exist: nothing is
 * written until the list has been checked and a bounded preview shown.
 * Five thousand generated cards are cheap to make and expensive
 * to pick back out of a deck by hand.
 *
 * The upload is chunked. Five hundred rows a request, each note carrying an id
 * this screen generated, so a chunk that was sent twice writes nothing the
 * second time and a connection that dropped can be carried on from where it
 * stopped rather than started again.
 */
export function ImportScreen({ deckId }: { readonly deckId?: string }) {
  const offline = useOffline();
  const loadId = useId();
  const saved = useQuery({
    queryKey: ['import-drafts', offline.accountId, accountEpoch(), loadId],
    queryFn: () => importDrafts(offline.accountId!),
    enabled: !!offline.accountId,
    networkMode: 'always',
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (!offline.accountId || saved.isPending) return <SkeletonRows rows={4} />;
  return (
    <ImportWorkspace
      key={offline.accountId}
      accountId={offline.accountId}
      deckId={deckId}
      saved={saved.data ?? []}
      storageFailed={!!saved.error}
    />
  );
}

function ImportWorkspace({
  accountId,
  deckId,
  saved,
  storageFailed,
}: {
  readonly accountId: string;
  readonly deckId: string | undefined;
  readonly saved: readonly ImportDraft[];
  readonly storageFailed: boolean;
}) {
  const [selected, setSelected] = useState(
    () =>
      saved.find((draft) => deckId === undefined || draft.preparation.deck === deckId) ??
      newImportDraft(accountId, deckId),
  );
  const [drafts, setDrafts] = useState(saved);
  return (
    <ImportEditor
      key={selected.id}
      initialDraft={selected}
      deckId={deckId}
      saved={drafts}
      storageFailed={storageFailed}
      onChoose={async (draft) => {
        const next = await importDrafts(accountId);
        const selected = draft
          ? await saveImportDraft(next.find((entry) => entry.id === draft.id) ?? draft)
          : newImportDraft(accountId, deckId);
        setDrafts(next);
        setSelected(selected);
      }}
    />
  );
}

function ImportEditor({
  initialDraft,
  deckId,
  saved,
  storageFailed,
  onChoose,
}: {
  readonly initialDraft: ImportDraft;
  readonly deckId: string | undefined;
  readonly saved: readonly ImportDraft[];
  readonly storageFailed: boolean;
  readonly onChoose: (draft?: ImportDraft) => Promise<void>;
}) {
  const t = useTranslate();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const decks = useDeckTree();
  const offline = useOffline();
  const capability = useCapabilities();
  const draft = useImportDraft(initialDraft);
  const { deck, raw, mode, format, noteType, columns, resolution, overrides } =
    draft.draft.preparation;
  const [stage, setStage] = useState<Stage>(() => {
    const delivery = initialDraft.delivery;
    if (delivery?.summary)
      return {
        kind: 'done',
        notes: delivery.summary.notes,
        cards: delivery.summary.cards,
        merged: delivery.attempt.merge.length,
        ...(delivery.attempt.create.length ? { batchId: delivery.attempt.batchId } : {}),
      };
    if (delivery)
      return {
        kind: 'importing',
        attempt: delivery.attempt,
        done: delivery.done,
        total: Math.ceil(delivery.attempt.create.length / IMPORT_CHUNK_SIZE),
        merged: delivery.merged ?? 0,
        phase:
          delivery.done < Math.ceil(delivery.attempt.create.length / IMPORT_CHUNK_SIZE)
            ? 'notes'
            : (delivery.merged ?? 0) < delivery.attempt.merge.length
              ? 'merges'
              : 'reconcile',
        failed: true,
      };
    const p = initialDraft.preparation;
    return p.preview
      ? {
          kind: 'preview',
          parsed: parseImport(p.raw, p.format || detectFormat(p.raw), {
            noteType: p.noteType,
            ...(p.columns.length ? { columns: p.columns } : {}),
          }),
        }
      : { kind: 'source' };
  });
  const [duplicates, setDuplicates] = useState<readonly DuplicateMatch[]>([]);
  const [duplicateStatus, setDuplicateStatus] = useState<'unavailable' | 'local' | 'confirmed'>(
    'unavailable',
  );
  const [changedDuplicates, setChangedDuplicates] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkSequence = useRef(0);
  const duplicateRequest = useRef<AbortController | undefined>(undefined);
  const finalDuplicateRequest = useRef<AbortController | undefined>(undefined);
  const [failure, setFailure] = useState<unknown>();
  const [prompt, setPrompt] = useState(false);
  const applying = useRef(false);
  const uploading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      finalDuplicateRequest.current?.abort();
    };
  }, []);
  const switchingDraft = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState<
    { readonly notes: number; readonly reviewedCards: number } | undefined
  >();

  const tree = decks.data ?? [];
  const chosenFormat = useMemo(() => format || detectFormat(raw), [format, raw]);

  async function chooseDraft(next?: ImportDraft, separate = false) {
    if (switchingDraft.current) return;
    switchingDraft.current = true;
    setSwitching(true);
    try {
      if (separate) {
        const copy = {
          ...newImportDraft(initialDraft.accountId, deck),
          preparation: draft.current.current.preparation,
        };
        await onChoose(await saveImportDraft(copy));
      } else if (await draft.persist()) await onChoose(next);
    } catch {
      toast.show(t('import.draftsUnavailable'));
    } finally {
      switchingDraft.current = false;
      setSwitching(false);
    }
  }

  /** Parsing and field/card previews never require a connection. */
  function read() {
    setFailure(undefined);

    const parsed = parseImport(raw, chosenFormat, {
      noteType,
      ...(columns.length > 0 ? { columns } : {}),
    });

    draft.edit({ preview: true, columns: parsed.columns ?? [] });
    setStage({ kind: 'preview', parsed });
  }

  const checkParsed = useCallback(
    async (parsed: ParseResult) => {
      if (applying.current) return;
      duplicateRequest.current?.abort();
      const controller = new AbortController();
      duplicateRequest.current = controller;
      const sequence = ++checkSequence.current;
      const current = importDraftVisit(initialDraft.accountId);
      setFailure(undefined);
      setDuplicates([]);
      setDuplicateStatus('unavailable');
      setChangedDuplicates(false);
      setChecking(true);

      try {
        const terms = parsed.rows.map((row) => termOf(row.fields)).filter((term) => term !== '');
        let found: DuplicateMatch[] = [];
        let localAvailable = offline.available;
        if (!capability.server && !localAvailable && deck) {
          // Loss can interrupt the downloader after committing its final page,
          // before publishing availability. Trust the durable boundary for local
          // preview only; application still requires fresh server validation.
          const db = await openCollection(initialDraft.accountId);
          try {
            localAvailable = (await metadata(db)).complete;
          } finally {
            db.close();
          }
          current();
        }
        if (capability.server && deck) found = await findDuplicates(deck, terms, controller.signal);
        else if (localAvailable && deck) {
          const keys = new Set(parsed.rows.map((row) => noteTermKey(row.fields)));
          let cursor: string | undefined;
          do {
            const page = await localNotes({ deckId: deck }, cursor);
            found.push(
              ...page.items
                .filter((note) => keys.has(noteTermKey(note.fields)))
                .map((note) => ({
                  term: noteTermKey(note.fields),
                  noteId: note.id,
                  noteType: note.noteType,
                  deckId: note.deckId,
                  written: termOf(note.fields),
                })),
            );
            cursor = page.nextCursor;
          } while (cursor);
        }
        current();
        if (sequence === checkSequence.current) {
          setDuplicates(found);
          setDuplicateStatus(
            capability.server && deck
              ? 'confirmed'
              : localAvailable && deck
                ? 'local'
                : 'unavailable',
          );
        }
      } catch (error) {
        // Keep the preview, but do not write before duplicate lookup succeeds.
        if (sequence === checkSequence.current) {
          if (capability.server && hasServerAuthority()) setFailure(error);
          setDuplicates([]);
        }
      } finally {
        if (sequence === checkSequence.current) setChecking(false);
      }
    },
    [deck, capability.server, offline.available, initialDraft.accountId],
  );

  const parsed = stage.kind === 'preview' ? stage.parsed : undefined;
  const connection = connectionEpoch();
  useEffect(() => {
    let active = true;
    const sequence = checkSequence;
    void Promise.resolve().then(() => {
      if (active && parsed) void checkParsed(parsed);
    });
    return () => {
      active = false;
      sequence.current++;
      duplicateRequest.current?.abort();
    };
  }, [parsed, checkParsed, connection]);

  async function start() {
    if (!parsed || applying.current || !hasServerAuthority()) return;
    applying.current = true;
    setChecking(true);
    const visit = importDraftVisit(initialDraft.accountId);
    const current = () => {
      visit();
      if (!mounted.current) throw new Error('import_visit_ended');
    };
    checkSequence.current++;
    duplicateRequest.current?.abort();
    const controller = new AbortController();
    finalDuplicateRequest.current = controller;
    const preparation = draft.current.current.preparation;
    try {
      const found = await findDuplicates(
        deck,
        parsed.rows.map((row) => termOf(row.fields)).filter(Boolean),
        controller.signal,
      );
      current();
      if (!hasServerAuthority() || preparation !== draft.current.current.preparation) return;
      setFailure(undefined);
      setDuplicates(found);
      setDuplicateStatus('confirmed');
      const signature = (matches: readonly DuplicateMatch[]) =>
        JSON.stringify(
          matches
            .map(({ term, noteId, noteType, deckId }) => [term, noteId, noteType, deckId])
            .sort(),
        );
      if (signature(found) !== signature(duplicates)) {
        setChangedDuplicates(true);
        return;
      }
      const choices = draft.current.current.preparation;
      await upload(createAttempt(parsed, found, choices.resolution, choices.overrides, deck));
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setFailure(error);
    } finally {
      applying.current = false;
      finalDuplicateRequest.current = undefined;
      setChecking(false);
    }
  }

  /**
   * Sends the list, a chunk at a time.
   *
   * @param from which chunk to start at, so a failure can be carried on from
   */
  async function upload(plan: ImportAttempt, from = 0) {
    if (uploading.current) return;
    if (!hasServerAuthority()) {
      toast.show(t('offline.serverRequired'));
      return;
    }
    const visit = importDraftVisit(initialDraft.accountId);
    const current = () => {
      visit();
      if (!mounted.current) throw new Error('import_visit_ended');
    };
    const batchId = plan.create.length > 0 ? plan.batchId : undefined;
    const total = Math.ceil(plan.create.length / IMPORT_CHUNK_SIZE);
    let merged = draft.current.current.delivery?.merged ?? 0;

    uploading.current = true;
    setFailure(undefined);
    setStage({
      kind: 'importing',
      attempt: plan,
      ...(batchId === undefined ? {} : { batchId }),
      done: from,
      total,
      merged,
      phase: from < total ? 'notes' : merged < plan.merge.length ? 'merges' : 'reconcile',
    });

    try {
      draft.delivery({ attempt: plan, done: from, merged });
      if (!(await draft.persist())) throw new Error('import_draft_storage');
      current();
      if (!hasServerAuthority()) throw new Error('import_connection_required');
      if (from === 0 && batchId) {
        await request('/imports', {
          method: 'POST',
          body: {
            id: batchId,
            deckId: plan.deckId,
            source: plan.source,
            format: plan.format,
          },
        });
      }

      for (let index = from; index < total; index += 1) {
        current();
        if (!hasServerAuthority()) throw new Error('import_connection_required');
        if (!batchId) {
          throw new Error('an import chunk needs a batch');
        }

        await request(`/imports/${batchId}/notes`, {
          method: 'POST',
          body: {
            notes: plan.create
              .slice(index * IMPORT_CHUNK_SIZE, (index + 1) * IMPORT_CHUNK_SIZE)
              .map((row) => ({
                id: row.id,
                noteType: plan.noteType,
                fields: row.fields,
                tags: row.tags,
                ...(row.rank === undefined ? {} : { rank: row.rank }),
              })),
          },
        });

        current();
        draft.delivery({ attempt: plan, done: index + 1, merged });
        if (!(await draft.persist())) throw new Error('import_draft_storage');

        setStage({
          kind: 'importing',
          attempt: plan,
          batchId,
          done: index + 1,
          total,
          merged,
          phase: 'notes',
        });
      }

      // Keep the server's existing fill-blank merge validation. Two requests may
      // travel together; only a fully acknowledged group advances recovery.
      for (; merged < plan.merge.length;) {
        setStage({
          kind: 'importing',
          attempt: plan,
          ...(batchId ? { batchId } : {}),
          done: total,
          total,
          merged,
          phase: 'merges',
        });
        const end = Math.min(merged + 20, plan.merge.length);
        let next = merged;
        let stopped = false;
        async function mergeNext() {
          try {
            while (!stopped && next < end) {
              current();
              if (!hasServerAuthority()) throw new Error('import_connection_required');
              const merge = plan.merge[next++]!;
              await request(`/notes/${merge.noteId}`, {
                method: 'PATCH',
                body: { fields: merge.fields, noteType: plan.noteType, merge: true },
              });
            }
          } catch (error) {
            stopped = true;
            throw error;
          }
        }
        const outcomes = await Promise.allSettled([mergeNext(), mergeNext()]);
        const refused = outcomes.find((outcome) => outcome.status === 'rejected');
        if (refused?.status === 'rejected') throw refused.reason;
        current();
        merged = end;
        draft.delivery({ attempt: plan, done: total, merged });
        if (!(await draft.persist())) throw new Error('import_draft_storage');
      }

      current();
      setStage({
        kind: 'importing',
        attempt: plan,
        ...(batchId ? { batchId } : {}),
        done: total,
        total,
        merged,
        phase: 'reconcile',
      });
      const summary = batchId
        ? await request<{ notes: number; cards: number }>(`/imports/${batchId}`)
        : { notes: 0, cards: 0 };
      current();
      if (
        !Number.isSafeInteger(summary.notes) ||
        summary.notes !== plan.create.length ||
        !Number.isSafeInteger(summary.cards) ||
        summary.cards < 0
      )
        throw new Error('import_reconciliation');
      draft.delivery({
        attempt: plan,
        done: total,
        merged,
        summary: { notes: summary.notes, cards: summary.cards },
      });
      if (!(await draft.persist())) throw new Error('import_draft_storage');
      current();

      // The list and tree are intentionally fresh for five minutes between
      // collection screens. This write happened outside the normal note
      // mutations, so mark both stale before the person returns to the deck.
      // Otherwise the destination remounts its pre-import cached page and
      // looks empty until a full reload or the freshness window expires.
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: [NOTE_KEY] }),
        queryClient.invalidateQueries({ queryKey: DECK_TREE_KEY }),
        queryClient.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: ['practice-notes'], refetchType: 'none' }),
        queryClient.invalidateQueries({ queryKey: ['practice-summary'], refetchType: 'none' }),
      ]);

      // Warm the exact destination first page, including when its old query is inactive.
      const destination = noteQueryString({ deckId: plan.deckId, sort: 'created' });
      void queryClient
        .fetchInfiniteQuery({
          queryKey: [NOTE_KEY, 'list', destination],
          initialPageParam: undefined as string | undefined,
          staleTime: 0,
          queryFn: ({ signal }) =>
            request<{ items: Note[]; nextCursor?: string }>(`/notes?${destination}&limit=1000`, {
              signal,
            }),
          getNextPageParam: (page) => page.nextCursor,
          pages: 1,
        })
        .catch(() => undefined);
      setStage({
        kind: 'done',
        ...(batchId === undefined ? {} : { batchId }),
        notes: summary.notes,
        cards: summary.cards,
        merged,
      });
    } catch (error) {
      setFailure(error);
      setStage((current) =>
        current.kind === 'importing' ? { ...current, failed: true } : current,
      );
    } finally {
      uploading.current = false;
    }
  }

  async function undo(batchId: string) {
    if (!hasServerAuthority()) {
      toast.show(t('offline.serverRequired'));
      return;
    }
    const current = importDraftVisit(initialDraft.accountId);
    await request(`/imports/${batchId}/undo`, { method: 'POST' });
    current();

    setConfirmUndo(undefined);
    toast.show(t('import.undone'));
    setStage({ kind: 'source' });
    // Keep the source available after Undo without reopening its completed delivery.
    draft.delivery(undefined);
    draft.edit({ preview: false });
  }

  return (
    <section data-screen="" className="flex flex-col gap-20">
      <header className="flex items-center justify-between gap-12">
        <h1 className="font-display text-24 tracking-tight text-primary">{t('import.title')}</h1>

        <Button variant="quiet" onClick={() => setPrompt(true)}>
          {t('import.copyPrompt')}
        </Button>
      </header>
      <CollectionPath tree={tree} id={deck} />

      <div className="flex flex-col gap-8">
        <p role="status" className="text-14 text-secondary">
          {t(
            draft.status === 'failed'
              ? draft.conflict
                ? 'import.draftConflict'
                : 'import.draftFailed'
              : draft.status === 'saved'
                ? draft.draft.delivery
                  ? 'import.checkpointSaved'
                  : 'import.draftSaved'
                : 'import.draftPending',
          )}
        </p>
        {storageFailed ? (
          <p className="text-14 text-error">{t('import.draftsUnavailable')}</p>
        ) : undefined}
        <div className="flex flex-wrap gap-8">
          <Button
            variant="quiet"
            busy={draft.status === 'saving' || switching}
            onClick={() => void draft.persist()}
          >
            {t('import.saveDraft')}
          </Button>
          <Button
            variant="text"
            onClick={() => {
              const link = document.createElement('a');
              const url = URL.createObjectURL(
                new Blob([raw], { type: 'text/plain;charset=utf-8' }),
              );
              link.href = url;
              link.download = `import-source.${chosenFormat === 'json' ? 'json' : 'txt'}`;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            {t('import.saveSource')}
          </Button>
          <Button
            variant="text"
            disabled={switching || (stage.kind === 'importing' && !stage.failed)}
            onClick={() => void chooseDraft()}
          >
            {t('import.newDraft')}
          </Button>
          {draft.conflict &&
          (!draft.draft.delivery ||
            draft.draft.delivery.attempt.batchId !== draft.committedAttempt.current) ? (
            <Button
              variant="quiet"
              disabled={switching}
              onClick={() => void chooseDraft(undefined, true)}
            >
              {t('import.saveSeparateDraft')}
            </Button>
          ) : undefined}
        </div>
        {saved.length > 0 ? (
          <Disclosure title={t('import.savedDrafts')}>
            <div className="flex flex-col gap-8 py-8">
              {saved.map((entry, index) => (
                <Button
                  key={entry.id}
                  variant="quiet"
                  disabled={
                    switching ||
                    entry.id === initialDraft.id ||
                    (stage.kind === 'importing' && !stage.failed)
                  }
                  onClick={() => void chooseDraft(entry)}
                >
                  {t('import.draftName', {
                    number: index + 1,
                    deck: findDeck(tree, entry.preparation.deck)?.name ?? t('import.deck'),
                  })}
                </Button>
              ))}
            </div>
          </Disclosure>
        ) : undefined}
      </div>

      <fieldset className="contents" disabled={switching} aria-busy={switching}>
        {stage.kind === 'source' ? (
          <ImportSource
            scoped={deckId !== undefined}
            decks={tree}
            deck={deck}
            raw={raw}
            mode={mode}
            onMode={(mode) => draft.edit({ mode })}
            noteType={noteType}
            onDeck={(deck) => draft.edit({ deck, overrides: {} })}
            onRaw={(value) => {
              draft.edit({ raw: value, columns: [], overrides: {} });
            }}
            onFormat={(format) =>
              draft.edit({
                format,
                ...(format === draft.current.current.preparation.format
                  ? {}
                  : { columns: [], overrides: {} }),
              })
            }
            onNoteType={(noteType) => draft.edit({ noteType, columns: [], overrides: {} })}
            left={draft.draft.preparation.left}
            right={draft.draft.preparation.right}
            onLeft={(left) => draft.edit({ left })}
            onRight={(right) => draft.edit({ right })}
            onRead={() => void read()}
          />
        ) : undefined}

        {stage.kind === 'preview' ? (
          <Preview
            deckId={deck}
            parsed={stage.parsed}
            duplicates={duplicates}
            resolution={resolution}
            overrides={overrides}
            blocked={
              !deck ||
              failure !== undefined ||
              !capability.server ||
              duplicateStatus !== 'confirmed'
            }
            duplicateStatus={duplicateStatus}
            changedDuplicates={changedDuplicates}
            onOverride={(line, value) => {
              const next = { ...overrides };
              if (value === '') delete next[line];
              else next[line] = value;
              draft.edit({ overrides: next });
            }}
            checking={checking}
            columns={columns}
            onColumns={(next) => {
              draft.edit({ columns: next, overrides: {} });
              setStage({
                kind: 'preview',
                parsed: parseImport(raw, chosenFormat, { noteType, columns: next }),
              });
            }}
            onResolution={(resolution) => draft.edit({ resolution })}
            onBack={() => {
              checkSequence.current++;
              finalDuplicateRequest.current?.abort();
              draft.edit({ preview: false });
              setStage({ kind: 'source' });
            }}
            onStart={() => void start()}
          />
        ) : undefined}

        {stage.kind === 'importing' ? (
          <Card className="flex flex-col gap-16">
            <p role="status" className="text-15 text-primary">
              {t(
                stage.phase === 'merges'
                  ? 'import.merging'
                  : stage.phase === 'reconcile'
                    ? 'import.reconciling'
                    : 'import.importing',
              )}
            </p>

            <Progress
              value={
                (Math.min(stage.done * IMPORT_CHUNK_SIZE, stage.attempt.create.length) +
                  stage.merged) /
                Math.max(1, stage.attempt.create.length + stage.attempt.merge.length)
              }
              label={t('import.importing')}
            />

            <p className="text-13 text-tertiary" data-numeric="">
              {stage.phase === 'merges'
                ? t('import.mergeProgress', {
                    done: stage.merged,
                    total: stage.attempt.merge.length,
                  })
                : t('import.progress', { done: stage.done, total: stage.total })}
            </p>

            {stage.failed ? (
              <>
                <p className="text-14 leading-body text-error">
                  {t('import.failed', { done: stage.done, total: stage.total })}
                </p>
                {failure instanceof ApiFailure ||
                (failure instanceof Error && failure.message === 'import_reconciliation') ? (
                  <p role="alert" className="text-14 leading-body text-error">
                    {t(
                      failure instanceof ApiFailure
                        ? describe(failure).key
                        : 'import.reconcileFailed',
                      failure instanceof ApiFailure ? describe(failure).values : {},
                    )}
                  </p>
                ) : undefined}
                <Button
                  variant="primary"
                  disabled={!capability.server}
                  onClick={() => {
                    void upload(stage.attempt, stage.done);
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
            {stage.merged > 0 ? (
              <p className="text-14 leading-body text-secondary" data-numeric="">
                {t('import.doneMerged', { count: stage.merged })}
              </p>
            ) : undefined}
            {stage.batchId ? (
              <>
                <p className="text-14 leading-body text-secondary">{t('import.undoBoundary')}</p>
              </>
            ) : undefined}

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

              {deck !== '' && stage.notes > 0 ? (
                <Button
                  variant="quiet"
                  onClick={() =>
                    void navigate({ to: '/notes', search: { deckId: deck, learning: 'triage' } })
                  }
                >
                  {t('import.triage')}
                </Button>
              ) : undefined}

              {stage.batchId ? (
                <Button
                  variant="destructive"
                  disabled={!capability.server}
                  onClick={async () => {
                    if (!hasServerAuthority()) return;
                    const summary = await request<{ notes: number; reviewedCards: number }>(
                      `/imports/${stage.batchId}`,
                    );

                    setConfirmUndo(summary);
                  }}
                >
                  {t('import.undo')}
                </Button>
              ) : undefined}
            </div>
          </Card>
        ) : undefined}

        {failure && stage.kind !== 'importing' ? (
          <ErrorState
            message={t(describe(failure).key, describe(failure).values)}
            retryLabel={t('common.retry')}
            {...(stage.kind === 'preview' ? { onRetry: () => void checkParsed(stage.parsed) } : {})}
          />
        ) : undefined}
      </fieldset>
      <PromptDialog
        open={prompt}
        onOpenChange={setPrompt}
        deck={deck === '' ? undefined : findDeck(tree, deck)}
        decks={tree}
      />

      {draft.navigation.status === 'blocked' ? (
        <Dialog
          open
          onOpenChange={() => draft.navigation.reset?.()}
          title={t('import.draftLeaveTitle')}
        >
          <p className="text-14 text-secondary">{t('import.draftFailed')}</p>
          <DialogFooter>
            <Button
              variant="primary"
              full
              onClick={async () => {
                if (await draft.persist()) draft.navigation.proceed?.();
              }}
            >
              {t('import.saveDraft')}
            </Button>
            <Button variant="text" full onClick={() => draft.navigation.reset?.()}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </Dialog>
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

            <Button variant="destructive" full onClick={() => void undo(stage.batchId!)}>
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

/** The table: every row, and what is wrong with it. */
function Preview({
  deckId,
  parsed,
  duplicates,
  resolution,
  overrides,
  onOverride,
  blocked,
  duplicateStatus,
  changedDuplicates,
  checking,
  columns,
  onColumns,
  onResolution,
  onBack,
  onStart,
}: {
  readonly deckId: string;
  readonly parsed: ParseResult;
  readonly duplicates: readonly DuplicateMatch[];
  readonly resolution: Resolution;
  readonly overrides: Overrides;
  readonly onOverride: (line: number, value: Resolution | '') => void;
  readonly blocked: boolean;
  readonly duplicateStatus: 'unavailable' | 'local' | 'confirmed';
  readonly changedDuplicates: boolean;
  readonly checking: boolean;
  readonly columns: readonly string[];
  readonly onColumns: (columns: readonly string[]) => void;
  readonly onResolution: (value: Resolution) => void;
  readonly onBack: () => void;
  readonly onStart: () => void;
}) {
  const t = useTranslate();
  const decks = useDeckTree();
  const [showCards, setShowCards] = useState(false);
  const analysis = useMemo(() => analyseImport(parsed), [parsed]);
  const known = useMemo(() => groupMatches(duplicates), [duplicates]);
  const plan = useMemo(
    () => planRows(parsed, duplicates, resolution, overrides, analysis),
    [parsed, duplicates, resolution, overrides, analysis],
  );
  const firstValid = parsed.rows.find((_, index) => analysis[index]!.problems.missing.length === 0);
  const firstFields = firstValid && noteFieldsSchemas[parsed.noteType].safeParse(firstValid.fields);
  const cards = firstFields?.success
    ? openingCards(parsed.noteType, firstFields.data, settingsFor(decks.data ?? [], deckId).ladder)
    : [];

  const problems = analysis.filter(({ problems: found }) => {
    return found.missing.length > 0 || found.exampleMisses || found.duplicateInFile;
  });

  // Only the first two hundred are drawn. The counts above them are over the
  // whole list, and nobody reads five thousand rows to decide.
  const shown = parsed.rows.slice(0, 200);

  return (
    <div className="flex flex-col gap-20">
      {parsed.columns &&
      (parsed.format === 'csv' || parsed.format === 'tsv' || parsed.format === 'anki') ? (
        <div className="flex flex-col gap-8">
          <GroupLabel>{t('import.columns')}</GroupLabel>

          <div className="grid gap-8 sm:grid-cols-3">
            {columns.map((column, index) => (
              <Select
                key={index}
                disabled={checking}
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
                    {t(fieldLabelKey(field))}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        </div>
      ) : undefined}

      <Panel className="flex flex-col gap-8">
        <p className="text-13 text-secondary">
          {t(`import.format.${parsed.format}`)} · {t(`note.type.${parsed.noteType}`)}
        </p>
        <p role="status" className="text-14 text-secondary">
          {t(
            duplicateStatus === 'confirmed'
              ? 'import.duplicatesConfirmed'
              : duplicateStatus === 'local'
                ? 'import.duplicatesLocal'
                : 'import.duplicatesUnavailable',
          )}
        </p>
        {changedDuplicates ? (
          <p role="status" className="text-14 text-secondary">
            {t('import.duplicatesChanged')}
          </p>
        ) : undefined}
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
          <p role="alert" className="text-14 text-error">
            {t(parsed.format === 'json' ? 'import.jsonError' : 'import.tableError', {
              row: parsed.failures[0]?.line ?? 1,
            })}
          </p>
        ) : undefined}
      </Panel>

      {plan.create.length + plan.merge.length === 0 && !checking && !blocked ? (
        <p className="text-14 leading-body text-secondary">{t('import.nothingToImport')}</p>
      ) : undefined}

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
              disabled={checking}
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

      {cards.length > 0 && (
        <Disclosure
          title={t('import.generatedPreview')}
          open={showCards}
          onOpenChange={setShowCards}
        >
          {showCards && <CardPreview cards={cards.map((card) => ({ ...card, change: 'adds' }))} />}
        </Disclosure>
      )}
      <div className="flex flex-col gap-4">
        <GroupLabel>{t('import.preview')}</GroupLabel>

        <div
          data-g="card"
          data-rows=""
          className="flex flex-col overflow-hidden rounded-24 border border-glass"
        >
          {shown.map((row, index) => {
            const matches = known.get(noteTermKey(row.fields)) ?? [];
            const decision = resolveDuplicate(
              matches,
              parsed.noteType,
              resolution,
              overrides[row.line],
            );

            return (
              <div key={row.line} data-import-row="" className="flex flex-col gap-8 px-16 py-12">
                <PreviewRow
                  row={row}
                  noteType={parsed.noteType}
                  problems={analysis[index]!.problems}
                  {...(decision.target === undefined
                    ? {}
                    : {
                        duplicateIn: findDeck(decks.data ?? [], decision.target.deckId)?.name ?? '',
                      })}
                />
                {matches.length > 0 ? (
                  <FormField
                    label={t('import.rowAction', { row: row.line })}
                    hint={[
                      decision.ambiguous
                        ? t('import.ambiguous')
                        : decision.incompatible
                          ? t('import.incompatible')
                          : t('import.compatible'),
                      t('import.effectiveAction', {
                        action: t(`import.resolve.${decision.action}`),
                      }),
                      overrides[row.line] === undefined ? '' : t('import.overridden'),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {(props) => (
                      <Select
                        {...props}
                        disabled={checking}
                        className="scroll-my-96"
                        value={overrides[row.line] ?? ''}
                        onChange={(event) =>
                          onOverride(row.line, event.target.value as Resolution | '')
                        }
                      >
                        <option value="">{t('import.useDefault')}</option>
                        <option value="skip">{t('import.resolve.skip')}</option>
                        <option value="merge" disabled={!decision.target}>
                          {t('import.resolve.merge')}
                        </option>
                        <option value="create">{t('import.resolve.create')}</option>
                      </Select>
                    )}
                  </FormField>
                ) : undefined}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-12">
        <Button
          variant="primary"
          full
          disabled={checking || blocked || plan.create.length + plan.merge.length === 0}
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

const PreviewRow = memo(function PreviewRow({
  row,
  noteType,
  problems,
  duplicateIn,
}: {
  readonly row: ParsedRow;
  readonly noteType: NoteTypeName;
  readonly problems: RowProblems;
  readonly duplicateIn?: string;
}) {
  const t = useTranslate();
  const [grammarOpen, setGrammarOpen] = useState(false);
  const meaning =
    typeof row.fields['translation'] === 'string'
      ? row.fields['translation']
      : typeof row.fields['back'] === 'string'
        ? row.fields['back']
        : '';

  const notes = [
    problems.missing.length > 0
      ? noteType === 'cloze'
        ? t('import.clozeError')
        : t('import.problemMissing', {
            fields: problems.missing.map((field) => t(fieldLabelKey(field))).join(', '),
          })
      : undefined,
    problems.exampleMisses ? t('import.problemExample') : undefined,
    problems.duplicateInFile ? t('import.problemDuplicateFile') : undefined,
    duplicateIn === undefined ? undefined : t('import.problemDuplicate', { deck: duplicateIn }),
    row.issue === undefined ? undefined : t('import.problemIssue'),
  ].filter((note): note is string => note !== undefined);

  return (
    <div className="flex min-h-52 flex-wrap items-center gap-12">
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
      {noteType === 'vocab' && !!row.fields['grammar'] && (
        <Disclosure
          quiet
          className="w-full"
          title={t('note.section.grammar')}
          open={grammarOpen}
          onOpenChange={setGrammarOpen}
        >
          {grammarOpen ? (
            <dl className="grid grid-cols-2 gap-12 text-13 text-secondary">
              {PRACTICE_FIELDS.filter(
                (field) =>
                  field.startsWith('grammar.') && practiceValue(row.fields, field) !== undefined,
              ).map((field) => {
                const value = practiceValue(row.fields, field);
                return (
                  <div key={field}>
                    <dt className="text-12 text-secondary">{t(practiceFieldLabel(field))}</dt>
                    <dd className="whitespace-pre-line text-primary">
                      {typeof value === 'boolean'
                        ? t(value ? 'practice.yes' : 'practice.no')
                        : value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : undefined}
        </Disclosure>
      )}
    </div>
  );
});
