import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { SlidersHorizontal, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import {
  PRACTICE_FIELDS,
  supportsPracticeResponse,
  practiceFields,
  practiceFieldLabel,
  practiceValue,
  samePracticeSides,
} from '@neuron/shared';
import type {
  Note,
  PracticeRun,
  PracticeSide,
  PracticeField,
  PracticeResponse,
} from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe } from '../../lib/api';
import { useCapabilities } from '../../lib/capabilities';
import { findDeck, settingsFor, useDeckTree } from '../../lib/decks';
import { NOTE_KEY, noteQueryString } from '../../lib/notes';
import { useOffline } from '../../lib/offline';
import { practicePool, practiceQuery, practiceStore } from '../../lib/practice';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { CompletionProgress } from '../../ui/completion-progress';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';
import { captureLearningReveal, LearningCard } from '../../ui/learning-card';
import { ModeHeader } from '../../ui/mode-header';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { TypedResponse } from '../../ui/typed-response';

import { ListeningPrompt, Speaker } from './listening-prompt';
import { ListeningSetup, useListeningAvailability } from './listening-setup';

/** Session completion chooses a deck; every entry resumes the same durable run. */
export function Practice({
  notes,
  onFinish,
}: {
  readonly notes: readonly Note[];
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const decks = useDeckTree();
  const ids = [...new Set(notes.map((note) => note.deckId))];
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const choosing = useRef(false);
  useEffect(() => {
    choosing.current = false;
  }, [location.href]);
  const explicit = (location.search as { practiceDeck?: string }).practiceDeck;
  const selected = explicit ?? (ids.length === 1 ? ids[0] : undefined);
  function exitDeck() {
    if (!explicit || ids.length === 1) {
      onFinish();
      return;
    }
    const search = { ...location.search } as Record<string, unknown>;
    delete search['practiceDeck'];
    const origin = router.buildLocation({ to: '/', search }).href;
    if (location.state.practiceOrigin === origin) router.history.back();
    else void router.navigate({ to: '/', search, replace: true });
  }
  if (selected) return <DeckPractice key={selected} deckId={selected} onFinish={exitDeck} />;
  return (
    <section className="flex flex-col gap-16">
      <h1 className="text-24">{t('practice.title')}</h1>
      {ids.map((id) => (
        <Button
          key={id}
          onClick={() => {
            if (choosing.current) return;
            choosing.current = true;
            void router
              .navigate({
                to: '/',
                search: { learning: 'study', followup: 'practice', practiceDeck: id },
                state: (state) => ({ ...state, practiceOrigin: location.href }),
                resetScroll: false,
              })
              .catch(() => {
                choosing.current = false;
              });
          }}
        >
          {findDeck(decks.data ?? [], id)?.name ?? t('practice.title')}
        </Button>
      ))}
      <Button onClick={onFinish}>{t('common.back')}</Button>
    </section>
  );
}
declare module '@tanstack/react-router' {
  interface HistoryState {
    practiceOrigin?: string;
  }
}
export function DeckPractice({
  deckId,
  onFinish,
  entry,
}: {
  readonly entry?: 'resume' | 'setup';
  readonly deckId: string;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const account = useAccount();
  const offline = useOffline();
  const capability = useCapabilities();
  // The server's state is adopted when it answers; it never holds the screen back once the
  // device has its own record to show.
  const summary = useQuery({ ...practiceQuery(deckId), enabled: capability.server });
  const client = useQueryClient();
  const listKey = [NOTE_KEY, 'list', noteQueryString({ deckId, sort: 'created' })];
  const listState = client.getQueryState<{
    pages: { items: Note[]; nextCursor?: string; local?: true }[];
  }>(listKey);
  const complete =
    !listState?.isInvalidated &&
    listState?.data &&
    !listState.data.pages.some((page) => page.local) &&
    listState.data.pages.at(-1)?.nextCursor === undefined
      ? listState?.data?.pages.flatMap((page) => page.items)
      : undefined;
  const pool = useQuery({
    queryKey: ['practice-notes', deckId],
    staleTime: 15_000,
    // The downloaded collection answers while the browser reports no connection.
    networkMode: 'always',
    ...(complete && listState
      ? { initialData: complete, initialDataUpdatedAt: listState.dataUpdatedAt }
      : {}),
    queryFn: ({ signal }) => practicePool(deckId, signal),
  });
  const accountId = account.data?.id ?? offline.accountId;
  if (pool.data && accountId)
    return (
      <PersistentPractice
        entry={entry}
        accountId={accountId}
        deckId={deckId}
        notes={pool.data}
        latest={summary.data}
        serverError={summary.error}
        onRetryServer={() => void summary.refetch()}
        onFinish={onFinish}
      />
    );
  return (
    <section className="flex flex-col gap-16">
      <ModeHeader title={t('practice.title')} exitLabel={t('practice.exit')} onExit={onFinish} />
      {!capability.server && !capability.localCollection ? (
        <p role="status" className="text-14 text-secondary">
          {t('offline.serverRequired')}
        </p>
      ) : pool.error && !pool.data ? (
        <ErrorState
          message={t(describe(pool.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void pool.refetch()}
        />
      ) : (
        <SkeletonRows rows={3} />
      )}
    </section>
  );
}
function PersistentPractice({
  accountId,
  deckId,
  notes,
  onFinish,
  entry,
  latest,
  serverError,
  onRetryServer,
}: {
  readonly latest: { run: PracticeRun | null; version: number } | undefined;
  readonly serverError: unknown;
  readonly onRetryServer: () => void;
  readonly entry?: 'resume' | 'setup' | undefined;
  readonly accountId: string;
  readonly deckId: string;
  readonly notes: readonly Note[];
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const issueId = useId();
  const listeningId = useId();
  // One store per account and Deck outlives this screen, so reconnecting, a new pool or a server
  // answer never remounts the session or resets its progress. Later values arrive by refresh.
  const [store] = useState(() => practiceStore(accountId, deckId, notes, latest));
  useEffect(() => {
    store.refresh(notes, latest);
  }, [store, notes, latest]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = PRACTICE_FIELDS.filter((key) =>
    notes.some((note) => practiceValue(note.fields, key) !== undefined),
  );
  const [front, setFront] = useState<PracticeRun['front']>(fields[0] ?? 'front');
  const [back, setBack] = useState<PracticeRun['back']>(fields[1] ?? 'back');
  const [configuring, setConfiguring] = useState(false);
  const [active, setActive] = useState(entry === 'resume');
  const [confirmNew, setConfirmNew] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [response, setResponse] = useState<PracticeResponse>('reveal');
  const [typed, setTyped] = useState('');
  const [typingReady, setTypingReady] = useState(false);
  const [interaction, setInteraction] = useState(0);
  const [undo, setUndo] = useState<{ epoch: number; entries: PracticeRun[] }>({
    epoch: state.undoEpoch,
    entries: [],
  });
  const history = undo.epoch === state.undoEpoch ? undo.entries : [];
  const setHistory = (entries: PracticeRun[]) => setUndo({ epoch: state.undoEpoch, entries });
  const decks = useDeckTree();
  const account = useAccount();
  const language =
    settingsFor(decks.data ?? [], deckId).targetLanguage ?? account.data?.settings.targetLanguage;
  const run = state.run;
  const failure = state.error ?? (state.awaitingServer ? serverError : undefined);
  const [setupEntered, setSetupEntered] = useState(false);
  if (entry === 'setup' && !state.loading && !setupEntered) {
    setSetupEntered(true);
    if (run) {
      setFront(run.front);
      setBack(run.back);
      setResponse(run.response ?? 'reveal');
    }
    setConfiguring(true);
  }
  const deck = findDeck(decks.data ?? [], deckId);
  const listening = useListeningAvailability(decks.data ?? [], deck ? [deck] : []);
  const listeningBlocked = !listening.length || listening.some((item) => !item.language);
  const current = notes.find((note) => note.id === run?.queue[0]);
  const statuses = Object.values(run?.statuses ?? {});
  const known = statuses.filter((status) => status === 'known').length;
  const learning = statuses.filter((status) => status === 'learning').length;
  const eligible = notes.filter((note) =>
    supportsPracticeResponse(note.fields, front, back, response),
  );
  const answerFields =
    response === 'typing' && (!run || configuring) && !eligible.length
      ? fields.filter(
          (field) =>
            !samePracticeSides(front, field) &&
            notes.some((note) => supportsPracticeResponse(note.fields, front, field, 'typing')),
        )
      : [];
  const issue = !notes.length
    ? 'practice.noNotes'
    : samePracticeSides(front, back)
      ? 'practice.differentFields'
      : response === 'typing' &&
          !eligible.length &&
          (practiceFields(back).length !== 1 ||
            notes.some((note) => supportsPracticeResponse(note.fields, front, back, 'reveal')))
        ? 'practice.typingAnswerRequired'
        : response === 'listening' &&
            (!fields.includes('term') ||
              practiceFields(front).length !== 1 ||
              practiceFields(front)[0] !== 'term')
          ? fields.includes('term')
            ? 'practice.listeningWordRequired'
            : 'practice.listeningWordMissing'
          : !eligible.length
            ? 'practice.noMatchingNotes'
            : undefined;
  const sameRecipe =
    !!run &&
    (run.response ?? 'reveal') === response &&
    JSON.stringify(practiceFields(run.front)) === JSON.stringify(practiceFields(front)) &&
    JSON.stringify(practiceFields(run.back)) === JSON.stringify(practiceFields(back));
  const toast = useToast();
  // Every step is saved on this device before the screen moves on; `onCommit` runs in the same
  // task as the new card, so nothing in between is painted.
  function act(action: Parameters<typeof store.act>[0], onCommit?: () => void) {
    if (store.act(action, onCommit) === 'storage') toast.show(t('practice.storageOffline'));
  }
  const sideLabel = (side: PracticeSide) =>
    practiceFields(side)
      .map((field) => t(practiceFieldLabel(field)))
      .join(' + ');
  function resetEncounter() {
    // External-store notifications are synchronous. Clear the old reveal before
    // publishing a different Note so it cannot inherit the previous answer face.
    flushSync(() => {
      setTyped('');
      setInteraction((value) => value + 1);
      setTypingReady(false);
      setRevealed(false);
    });
  }
  function openSettings() {
    if (run) {
      setFront(run.front);
      setBack(run.back);
      setResponse(run.response ?? 'reveal');
    }
    setConfiguring(true);
  }
  function startRun() {
    act({ kind: 'start', front, back, response }, () => {
      setHistory([]);
      setConfiguring(false);
      setConfirmNew(false);
      setActive(true);
      resetEncounter();
    });
  }
  function applySettings() {
    if (run && !sameRecipe) {
      setConfirmNew(true);
    } else if (run) {
      setConfiguring(false);
      setActive(true);
    } else {
      startRun();
    }
  }
  return (
    <section
      data-screen=""
      data-learning-screen={run && active && !configuring ? '' : undefined}
      data-typing-ready={typingReady || undefined}
      className="neu-session flex flex-col gap-16"
    >
      <ModeHeader
        title={t('practice.title')}
        exitLabel={t('practice.exit')}
        onExit={onFinish}
        {...(run && active && !configuring
          ? { value: known, max: statuses.length, progressLabel: t('practice.knownProgress') }
          : {})}
        action={
          <div className="flex items-center gap-4">
            {run && active && !configuring && (
              <Button
                variant="text"
                className="w-44 text-secondary"
                aria-label={t('study.undo')}
                title={t('study.undo')}
                disabled={!history.length || !!state.error || history.at(-1)?.id !== run.id}
                onClick={() => {
                  const previous = history.at(-1);
                  if (!previous) return;
                  act({ kind: 'undo', previous }, () => {
                    setHistory(history.slice(0, -1));
                    resetEncounter();
                  });
                }}
              >
                <Undo2 size={20} strokeWidth={1.5} aria-hidden="true" />
              </Button>
            )}
          </div>
        }
      />
      {active && !configuring && run && (
        <div
          className="neu-practice-progress grid shrink-0 grid-cols-2 gap-16 text-12 text-secondary"
          aria-label={t('practice.progressLabel')}
        >
          <div
            role="group"
            className="flex items-baseline gap-8"
            aria-label={t('practice.learningCount', { count: learning })}
          >
            <strong data-numeric="" className="text-15 font-medium text-primary">
              {learning}
            </strong>
          </div>
          <div
            role="group"
            className="flex items-baseline justify-end gap-8 text-right"
            aria-label={t('practice.knownIndicator', { count: known })}
          >
            <strong data-numeric="" className="text-15 font-medium text-primary">
              {known}
            </strong>
          </div>
        </div>
      )}
      {failure ? (
        <ErrorState
          message={t(describe(failure).key)}
          retryLabel={t('common.retry')}
          onRetry={state.error ? store.retry : onRetryServer}
        />
      ) : null}
      {state.conflict ? (
        <PracticeConflict
          device={state.conflict.device}
          other={state.conflict.other}
          busy={state.committing}
          sideLabel={sideLabel}
          onKeep={store.resolve}
        />
      ) : state.loading ? (
        <SkeletonRows rows={3} />
      ) : run && !active && !configuring ? (
        <Card className="flex flex-col gap-16">
          <div className="flex items-center justify-between gap-12">
            <h2 className="text-20 text-primary">{t('practice.currentSetup')}</h2>
            <Button variant="quiet" className="text-13" onClick={openSettings}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              {t('practice.settings')}
            </Button>
          </div>
          <p className="text-14 text-secondary">{t(`practice.mode.${run.response ?? 'reveal'}`)}</p>
          <Disclosure quiet title={t('practice.fields')}>
            <div className="grid grid-cols-2 gap-12 text-13 text-secondary">
              <div>
                <span className="block">{t('practice.front')}</span>
                <strong className="text-15 font-medium text-primary">{sideLabel(run.front)}</strong>
              </div>
              <div>
                <span className="block">{t('practice.back')}</span>
                <strong className="text-15 font-medium text-primary">{sideLabel(run.back)}</strong>
              </div>
            </div>
          </Disclosure>
          <p className="text-13 text-secondary">
            {t('practice.pool', { count: statuses.length, total: notes.length })}
          </p>
          {run.response === 'listening' && (
            <ListeningSetup decks={decks.data ?? []} selected={deck ? [deck] : []} />
          )}
          <Button
            full
            variant="primary"
            disabled={run.response === 'listening' && listeningBlocked}
            onClick={() => setActive(true)}
          >
            {t('practice.resume')}
          </Button>
          <Button
            variant="quiet"
            disabled={run.response === 'listening' && listeningBlocked}
            onClick={() => {
              setFront(run.front);
              setBack(run.back);
              setResponse(run.response ?? 'reveal');
              setConfirmNew(true);
            }}
          >
            {t('practice.newRun')}
          </Button>
        </Card>
      ) : !run || configuring ? (
        <>
          <h2 className="text-20 text-primary">{t('practice.settings')}</h2>
          <p className="text-14 text-secondary">{t('practice.modeHint')}</p>
          <label className="flex flex-col gap-8 text-14">
            {t('practice.response')}
            <Select
              value={response}
              onChange={(event) => {
                const mode = event.target.value as PracticeResponse;
                setResponse(mode);
                if (
                  !run &&
                  mode === 'typing' &&
                  fields.includes('term') &&
                  fields.includes('translation')
                ) {
                  setFront('translation');
                  setBack('term');
                }
                if (!run && mode === 'listening' && fields.includes('term')) {
                  setFront('term');
                  setBack(fields.includes('translation') ? 'translation' : back);
                }
              }}
            >
              {(['reveal', 'typing', 'listening'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`practice.mode.${mode}`)}
                </option>
              ))}
            </Select>
          </label>
          {response !== 'reveal' && !issue && (
            <p className="text-13 text-secondary">{t(`practice.${response}Hint`)}</p>
          )}
          {response === 'listening' && (
            <div id={listeningId}>
              <ListeningSetup decks={decks.data ?? []} selected={deck ? [deck] : []} />
              {listening.some((item) => item.language && !item.voice) && (
                <p className="mt-4 text-13 text-secondary">{t('practice.voiceFallback')}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-12">
            {(['front', 'back'] as const).map((side) => (
              <PracticeFieldChoice
                key={side}
                label={t(`practice.${side}`)}
                available={fields}
                value={side === 'front' ? front : back}
                onChange={side === 'front' ? setFront : setBack}
              />
            ))}
          </div>
          <p className="text-13 text-secondary">
            {t('practice.pool', { count: eligible.length, total: notes.length })}
          </p>
          {issue && (
            <div role="status" className="flex flex-col gap-8 text-13 text-secondary">
              <p id={issueId}>{t(issue)}</p>
              {issue === 'practice.typingAnswerRequired' && answerFields.length > 0 && (
                <label className="flex flex-col gap-4">
                  {t('practice.chooseAnswer')}
                  <Select
                    value=""
                    onChange={(event) => setBack(event.target.value as PracticeField)}
                  >
                    <option value="" disabled>
                      {t('practice.chooseFields')}
                    </option>
                    {answerFields.map((field) => (
                      <option key={field} value={field}>
                        {t(practiceFieldLabel(field))}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {issue === 'practice.listeningWordRequired' && (
                <Button variant="text" className="self-start px-0" onClick={() => setFront('term')}>
                  {t('practice.useWord')}
                </Button>
              )}
              {(issue === 'practice.listeningWordMissing' ||
                (issue === 'practice.typingAnswerRequired' && !answerFields.length)) && (
                <Button
                  variant="text"
                  className="self-start px-0"
                  onClick={() => setResponse('reveal')}
                >
                  {t('practice.useSelfCheck')}
                </Button>
              )}
            </div>
          )}
          <Button
            variant="primary"
            aria-describedby={
              [
                issue ? issueId : '',
                response === 'listening' &&
                (listeningBlocked || listening.some((item) => !item.voice))
                  ? listeningId
                  : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
            disabled={
              samePracticeSides(front, back) ||
              !eligible.length ||
              !!state.error ||
              (response === 'listening' && listeningBlocked)
            }
            onClick={applySettings}
          >
            {t(run ? (sameRecipe ? 'practice.resume' : 'practice.newRun') : 'practice.start')}
          </Button>
          {run && (
            <Button variant="quiet" onClick={() => setConfiguring(false)}>
              {t('common.cancel')}
            </Button>
          )}
        </>
      ) : (
        <>
          {current ? (
            <>
              <LearningCard
                key={`${current.id}:${interaction}`}
                identity={current.id}
                answerFocused={run.response === 'listening'}
                context={t(`practice.mode.${run.response ?? 'reveal'}`)}
                prompt={
                  run.response === 'listening' ? (
                    <ListeningPrompt
                      key={current.id}
                      text={String(current.fields['term'] ?? '')}
                      language={language}
                    />
                  ) : (
                    <PracticeFace
                      fields={current.fields}
                      side={run.front}
                      language={language}
                      identity={current.id}
                    />
                  )
                }
                response={
                  run.response === 'typing' || run.response === 'listening' ? (
                    <TypedResponse
                      key={current.id}
                      value={typed}
                      onChange={setTyped}
                      answer={String(
                        practiceValue(
                          current.fields,
                          run.response === 'listening' ? 'term' : practiceFields(run.back)[0]!,
                        ) ?? '',
                      )}
                      alternatives={
                        (run.response === 'listening' || practiceFields(run.back)[0] === 'term') &&
                        Array.isArray(current.fields['acceptedAnswers'])
                          ? current.fields['acceptedAnswers'].filter(
                              (value): value is string => typeof value === 'string',
                            )
                          : []
                      }
                      language={language}
                      revealed={revealed}
                      onReveal={() => setRevealed(true)}
                      ready={typingReady}
                      onReadyChange={setTypingReady}
                    />
                  ) : undefined
                }
                answer={
                  revealed ? (
                    <PracticeFace
                      fields={current.fields}
                      side={
                        run.response === 'listening'
                          ? [...new Set(['term' as const, ...practiceFields(run.back)])]
                          : run.back
                      }
                      language={language}
                      identity={current.id}
                    />
                  ) : undefined
                }
              />
              {revealed ? (
                <div className="neu-learning-actions neu-reveal grid shrink-0 grid-cols-2 gap-8">
                  {[false, true].map((value) => (
                    <Button
                      key={String(value)}
                      variant={value ? 'primary' : 'quiet'}
                      disabled={!!state.error}
                      onClick={() =>
                        act({ kind: 'answer', noteId: current.id, known: value }, () => {
                          setHistory([...history, run]);
                          resetEncounter();
                        })
                      }
                    >
                      {t(value ? 'practice.know' : 'practice.learning')}
                    </Button>
                  ))}
                </div>
              ) : (
                <Button
                  className="neu-learning-actions shrink-0"
                  variant={
                    run.response === 'typing' || run.response === 'listening' ? 'quiet' : 'primary'
                  }
                  onClick={(event) => {
                    captureLearningReveal(event.currentTarget);
                    setTypingReady(false);
                    setRevealed(true);
                  }}
                >
                  {t('study.reveal')}
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="neu-reveal my-auto flex flex-col items-center gap-16 py-32 text-center">
                <CompletionProgress
                  value={known}
                  max={statuses.length}
                  label={t('practice.know')}
                />
                <h2 className="text-24">
                  {t(learning ? 'practice.roundComplete' : 'practice.cleared')}
                </h2>
                <p className="text-14 text-secondary">
                  {t('practice.completionCounts', { known, learning })}
                </p>
              </div>
              {learning > 0 ? (
                <Button
                  variant="primary"
                  disabled={!!state.error}
                  onClick={() => act({ kind: 'round' })}
                >
                  {t('practice.repeat')}
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  disabled={!!state.error}
                  onClick={() =>
                    act(
                      {
                        kind: 'start',
                        front: run.front,
                        back: run.back,
                        ...(run.response ? { response: run.response } : {}),
                      },
                      () => setHistory([]),
                    )
                  }
                >
                  {t('practice.restart')}
                </Button>
              )}
            </>
          )}
          {!current && (
            <Button variant={learning ? 'quiet' : 'primary'} onClick={onFinish}>
              {t('study.finish')}
            </Button>
          )}
        </>
      )}
      <Dialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title={t('practice.newRun')}
        description={t('practice.changeWarning')}
      >
        <DialogFooter>
          <Button onClick={() => setConfirmNew(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={startRun}>
            {t('practice.confirmNewRun')}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}

/** Two runs of one Deck that cannot both continue. The learner keeps one; nothing merges them. */
function PracticeConflict({
  device,
  other,
  busy,
  sideLabel,
  onKeep,
}: {
  readonly device: PracticeRun | null;
  readonly other: PracticeRun | null;
  readonly busy: boolean;
  readonly sideLabel: (side: PracticeSide) => string;
  readonly onKeep: (keep: 'device' | 'other') => void;
}) {
  const t = useTranslate();
  const describeRun = (run: PracticeRun | null) => {
    if (!run) return t('practice.conflict.none');
    const statuses = Object.values(run.statuses);
    return t('practice.conflict.summary', {
      round: run.round,
      known: statuses.filter((status) => status === 'known').length,
      total: statuses.length,
    });
  };
  return (
    <Card className="flex flex-col gap-16">
      <div className="flex flex-col gap-8">
        <h2 className="text-20 text-primary">{t('practice.conflict.title')}</h2>
        <p className="text-14 text-secondary">{t('practice.conflict.body')}</p>
      </div>
      {(
        [
          ['device', device],
          ['other', other],
        ] as const
      ).map(([side, run]) => (
        <div key={side} className="flex flex-col gap-4 border-t border-subtle pt-12">
          <p className="text-13 text-secondary">{t(`practice.conflict.${side}`)}</p>
          <p className="text-15 text-primary" data-numeric="">
            {describeRun(run)}
          </p>
          {run && (
            <p className="text-13 text-secondary">
              {t('practice.recipe', {
                mode: t(`practice.mode.${run.response ?? 'reveal'}`),
                front: sideLabel(run.front),
                back: sideLabel(run.back),
              })}
            </p>
          )}
        </div>
      ))}
      <div className="flex flex-col gap-8">
        <Button full variant="primary" disabled={busy || !device} onClick={() => onKeep('device')}>
          {t('practice.conflict.keepDevice')}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => onKeep('other')}>
          {t('practice.conflict.keepOther')}
        </Button>
      </div>
    </Card>
  );
}

function PracticeFieldChoice({
  label,
  available,
  value,
  onChange,
}: {
  readonly label: string;
  readonly available: readonly PracticeField[];
  readonly value: PracticeSide;
  readonly onChange: (side: PracticeSide) => void;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(practiceFields(value));
  return (
    <div className="flex min-w-0 flex-col gap-8 text-13 text-secondary">
      <span>{label}</span>
      <Button
        className="justify-start text-left"
        onClick={() => {
          setDraft(practiceFields(value));
          setOpen(true);
        }}
      >
        {practiceFields(value)
          .map((field) => t(practiceFieldLabel(field)))
          .join(' + ')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${label}: ${t('practice.chooseFields')}`}
        description={t('practice.chooseFieldsHint')}
      >
        <DialogBody>
          {available.map((field) => (
            <Checkbox
              key={field}
              checked={draft.includes(field)}
              disabled={!draft.includes(field) && draft.length >= 6}
              onChange={(checked) =>
                setDraft(checked ? [...draft, field] : draft.filter((item) => item !== field))
              }
            >
              {t(practiceFieldLabel(field))}
            </Checkbox>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="primary"
            disabled={!draft.length}
            onClick={() => {
              onChange(draft.length === 1 ? draft[0]! : draft);
              setOpen(false);
            }}
          >
            {t('common.apply')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function PracticeFace({
  fields,
  side,
  language,
  identity,
}: {
  readonly fields: Record<string, unknown>;
  readonly side: PracticeSide;
  readonly language: string | undefined;
  readonly identity: string;
}) {
  const t = useTranslate();
  const selected = practiceFields(side);
  const articleTerm = selected.includes('term') && selected.includes('grammar.article');
  const shown = articleTerm
    ? [
        'term' as const,
        ...selected.filter((field) => field !== 'term' && field !== 'grammar.article'),
      ]
    : selected;
  return (
    <div className="flex flex-col gap-16">
      {shown.map((field, index) => {
        const value = practiceValue(fields, field);
        const text = typeof value === 'boolean' ? t(value ? 'practice.yes' : 'practice.no') : value;
        return (
          <div
            key={field}
            className={
              index
                ? 'text-20' +
                  (index === 1 && shown[0] === 'term' ? ' border-t border-subtle pt-16' : '')
                : ''
            }
          >
            {index > 0 && (
              <p className="mb-4 text-12 text-secondary">{t(practiceFieldLabel(field))}</p>
            )}
            <div className={field === 'term' ? 'flex items-start gap-12' : ''}>
              <span className="min-w-0 whitespace-pre-line">
                {articleTerm && field === 'term'
                  ? `${practiceValue(fields, 'grammar.article')} ${text}`
                  : text}
              </span>
              {field === 'term' && (
                <Speaker key={identity} text={String(text ?? '')} language={language} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
