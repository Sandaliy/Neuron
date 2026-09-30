import { useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

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
import { describe, request } from '../../lib/api';
import { findDeck, settingsFor, useDeckTree } from '../../lib/decks';
import { practiceStore } from '../../lib/practice';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { CompletionProgress } from '../../ui/completion-progress';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { LearningCard } from '../../ui/learning-card';
import { ModeHeader } from '../../ui/mode-header';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';
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
  const [selected, setSelected] = useState(ids.length === 1 ? ids[0] : undefined);
  if (selected) return <DeckPractice deckId={selected} onFinish={onFinish} />;
  return (
    <section className="flex flex-col gap-16">
      <h1 className="text-24">{t('practice.title')}</h1>
      {ids.map((id) => (
        <Button key={id} onClick={() => setSelected(id)}>
          {findDeck(decks.data ?? [], id)?.name ?? t('practice.title')}
        </Button>
      ))}
      <Button onClick={onFinish}>{t('common.back')}</Button>
    </section>
  );
}
export function DeckPractice({
  deckId,
  onFinish,
}: {
  readonly deckId: string;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const account = useAccount();
  const pool = useQuery({
    queryKey: ['practice-notes', deckId],
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const notes: Note[] = [];
      let cursor: string | undefined;
      do {
        const page = await request<{ items: Note[]; nextCursor?: string }>(
          `/notes?deckId=${deckId}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`,
          { signal },
        );
        notes.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return notes;
    },
  });
  if (pool.data && account.data)
    return (
      <PersistentPractice
        accountId={account.data.id}
        deckId={deckId}
        notes={pool.data}
        onFinish={onFinish}
      />
    );
  return (
    <section className="flex flex-col gap-16">
      {pool.error ? (
        <ErrorState
          message={t(describe(pool.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void pool.refetch()}
        />
      ) : (
        <SkeletonRows rows={3} />
      )}
      <Button onClick={onFinish}>{t('common.back')}</Button>
    </section>
  );
}
function PersistentPractice({
  accountId,
  deckId,
  notes,
  onFinish,
}: {
  readonly accountId: string;
  readonly deckId: string;
  readonly notes: readonly Note[];
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const store = useMemo(() => practiceStore(accountId, deckId, notes), [accountId, deckId, notes]);
  useEffect(() => {
    store.refresh(notes);
  }, [store, notes]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = PRACTICE_FIELDS.filter((key) =>
    notes.some((note) => practiceValue(note.fields, key) !== undefined),
  );
  const [front, setFront] = useState<PracticeRun['front']>(fields[0] ?? 'front');
  const [back, setBack] = useState<PracticeRun['back']>(fields[1] ?? 'back');
  const [configuring, setConfiguring] = useState(false);
  const [active, setActive] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [response, setResponse] = useState<PracticeResponse>('reveal');
  const [typed, setTyped] = useState('');
  const [typingReady, setTypingReady] = useState(false);
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
  const deck = findDeck(decks.data ?? [], deckId);
  const listening = useListeningAvailability(decks.data ?? [], deck ? [deck] : []);
  const listeningBlocked = !listening.length || listening.some((item) => !item.voice);
  const current = notes.find((note) => note.id === run?.queue[0]);
  const statuses = Object.values(run?.statuses ?? {});
  const known = statuses.filter((status) => status === 'known').length;
  const learning = statuses.filter((status) => status === 'learning').length;
  const eligible = notes.filter((note) =>
    supportsPracticeResponse(note.fields, front, back, response),
  );
  const sameRecipe =
    !!run &&
    (run.response ?? 'reveal') === response &&
    JSON.stringify(practiceFields(run.front)) === JSON.stringify(practiceFields(front)) &&
    JSON.stringify(practiceFields(run.back)) === JSON.stringify(practiceFields(back));
  const sideLabel = (side: PracticeSide) =>
    practiceFields(side)
      .map((field) => t(practiceFieldLabel(field)))
      .join(' + ');
  function openSettings() {
    if (run) {
      setFront(run.front);
      setBack(run.back);
      setResponse(run.response ?? 'reveal');
    }
    setConfiguring(true);
  }
  function startRun() {
    setHistory([]);
    store.act({ kind: 'start', front, back, response });
    setTyped('');
    setTypingReady(false);
    setConfiguring(false);
    setConfirmNew(false);
    setRevealed(false);
    setActive(true);
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
      data-learning-screen={active && !configuring ? '' : undefined}
      data-typing-ready={typingReady || undefined}
      className="neu-session flex flex-col gap-16"
    >
      <ModeHeader
        title={t('practice.title')}
        exitLabel={t('practice.exit')}
        onExit={onFinish}
        {...(active && !configuring ? { value: learning + known, max: statuses.length } : {})}
        action={
          <div className="flex items-center gap-4">
            {run && (
              <span role="status" className="w-56 text-right text-12 text-secondary">
                {t(state.saving ? 'practice.saving' : 'practice.saved')}
              </span>
            )}
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
                  store.act({ kind: 'undo', previous });
                  setHistory(history.slice(0, -1));
                  setTyped('');
                  setTypingReady(false);
                  setRevealed(false);
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
          <div className="flex items-baseline gap-8">
            <span>{t('practice.learning')}</span>
            <strong data-numeric="" className="text-15 font-medium text-primary">
              {learning}
            </strong>
          </div>
          <div className="flex items-baseline justify-end gap-8 text-right">
            <span>{t('practice.know')}</span>
            <strong data-numeric="" className="text-15 font-medium text-primary">
              {known}
            </strong>
          </div>
        </div>
      )}
      {state.error ? (
        <ErrorState
          message={t(describe(state.error).key)}
          retryLabel={t('common.retry')}
          onRetry={store.retry}
        />
      ) : null}
      {state.loading ? (
        <SkeletonRows rows={3} />
      ) : run && !active && !configuring ? (
        <Card className="flex flex-col gap-16">
          <h2 className="text-20 text-primary">{t('practice.currentSetup')}</h2>
          <p className="text-14 text-secondary">{t(`practice.mode.${run.response ?? 'reveal'}`)}</p>
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
          <Button variant="text" onClick={openSettings}>
            {t('practice.settings')}
          </Button>
          <Button
            variant="text"
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
                if (!run && mode === 'listening') {
                  setFront('term');
                  setBack(fields.includes('translation') ? 'translation' : back);
                }
              }}
            >
              {(['reveal', 'typing', 'listening'] as const).map((mode) => (
                <option
                  key={mode}
                  value={mode}
                  disabled={mode === 'listening' && !fields.includes('term')}
                >
                  {t(`practice.mode.${mode}`)}
                </option>
              ))}
            </Select>
          </label>
          {response !== 'reveal' && (
            <p className="text-13 text-secondary">{t(`practice.${response}Hint`)}</p>
          )}
          {response === 'listening' && (
            <ListeningSetup decks={decks.data ?? []} selected={deck ? [deck] : []} />
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
          <Button
            variant="primary"
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
            <Button variant="text" onClick={() => setConfiguring(false)}>
              {t('common.cancel')}
            </Button>
          )}
        </>
      ) : (
        <>
          {current ? (
            <>
              <LearningCard
                identity={current.id}
                context={practiceFields(run.front)
                  .map((field) => t(practiceFieldLabel(field)))
                  .join(' · ')}
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
                      onClick={() => {
                        setHistory([...history, run]);
                        store.act({ kind: 'answer', noteId: current.id, known: value });
                        setTyped('');
                        setTypingReady(false);
                        setRevealed(false);
                      }}
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
                  onClick={() => setRevealed(true)}
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
                  onClick={() => store.act({ kind: 'round' })}
                >
                  {t('practice.repeat')}
                </Button>
              ) : (
                <Button
                  variant="text"
                  disabled={!!state.error}
                  onClick={() => {
                    setHistory([]);
                    store.act({
                      kind: 'start',
                      front: run.front,
                      back: run.back,
                      ...(run.response ? { response: run.response } : {}),
                    });
                  }}
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
          <div key={field} className={index ? 'text-20' : ''}>
            {index > 0 && (
              <p className="mb-4 text-12 text-secondary">{t(practiceFieldLabel(field))}</p>
            )}
            <p className="whitespace-pre-line">
              {articleTerm && field === 'term'
                ? `${practiceValue(fields, 'grammar.article')} ${text}`
                : text}
              {field === 'term' && (
                <Speaker key={identity} text={String(text ?? '')} language={language} />
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
