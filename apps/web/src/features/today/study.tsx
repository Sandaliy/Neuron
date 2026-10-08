import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  studyAvailableAt,
  createSchedulerConfig,
  createSeededRandom,
  seedFromReviewId,
  review,
  preview,
  queueSessionRetry,
  takeNextSessionCard,
} from '@neuron/core';
import type { SessionQueue, WorkloadCard, Rating } from '@neuron/core';
import { dailyStudySessionSchema, possibleCards, uuidV7 } from '@neuron/shared';
import type { Card as StudyCard, DailyStudySession, NoteFields } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { settingsFor, useDeckTree } from '../../lib/decks';
import { projectConfirmedReview } from '../../lib/review-projection';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { LearningCard } from '../../ui/learning-card';
import { ModeHeader } from '../../ui/mode-header';
import { ReviewTime } from '../../ui/review-time';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { TypedResponse } from '../../ui/typed-response';

import { DEFAULT_CARD_DISPLAY, displayedFace, RevealedStudyContent } from './card-display';
import { ListeningPrompt, Speaker } from './listening-prompt';
import { Practice } from './practice';

import type { CardDisplay } from './card-display';

export function workloadCard(card: StudyCard): WorkloadCard {
  const counters = {
    due: new Date(card.due),
    reps: card.reps,
    lapses: card.lapses,
    learningStep: card.learningStep,
  };
  if (
    card.state !== 'new' &&
    (card.stability === null || card.difficulty === null || card.lastReview === null)
  )
    throw new Error('Invalid reviewed card');
  return {
    id: card.id,
    noteId: card.noteId,
    direction: card.direction,
    scheduling:
      card.state === 'new'
        ? {
            ...counters,
            state: 'new',
            stability: undefined,
            difficulty: undefined,
            lastReview: undefined,
          }
        : {
            ...counters,
            state: card.state,
            stability: card.stability!,
            difficulty: card.difficulty!,
            lastReview: new Date(card.lastReview!),
          },
  };
}

type Answer = {
  id: string;
  cardId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  reviewedAt: string;
  durationMs: number;
};
type SessionAnswer = {
  answer: Answer;
  card: StudyCard;
  queue: SessionQueue;
  priorDue: string | undefined;
};
type Transport =
  { kind: 'answer'; entry: SessionAnswer } | { kind: 'undo'; entry: SessionAnswer; id: string };
const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

export function StudyScreen({
  onFinish,
  minutes,
  initialPlan,
  display = DEFAULT_CARD_DISPLAY,
}: {
  readonly display?: CardDisplay;
  readonly initialPlan?: DailyStudySession;
  readonly minutes: string;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const client = useQueryClient();
  const account = useAccount();
  const decks = useDeckTree();
  const [typed, setTyped] = useState('');
  const [typingReady, setTypingReady] = useState(false);
  const [interaction, setInteraction] = useState(0);
  const config = createSchedulerConfig({
    timezone: account.data?.timezone ?? 'UTC',
    dayCutoffHour: account.data?.dayCutoffHour ?? 4,
    ...(account.data?.settings.targetRetention === undefined
      ? {}
      : { desiredRetention: account.data.settings.targetRetention }),
  });
  const [plan, setPlan] = useState<DailyStudySession>();
  const [current, setCurrent] = useState<StudyCard>();
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [transportError, setTransportError] = useState<unknown>();
  const [pending, setPending] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [answeredCards, setAnsweredCards] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [morePlanned, setMorePlanned] = useState(false);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [practicing, setPracticing] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const history = useRef<SessionAnswer[]>([]);
  const transport = useRef<Transport[]>([]);
  const transportBusy = useRef(false);
  const confirmedAnswers = useRef(new Map<string, StudyCard>());
  const projectedAnswers = useRef(new Set<string>());
  const queue = useRef<SessionQueue>({ planned: [], retries: [], retryMayRun: false });
  const cards = useRef(new Map<string, StudyCard>());
  const projectedDue = useRef(new Map<string, string>());
  const started = useRef(0);
  const shown = useRef(0);
  const locked = useRef(false);
  const budget = useRef(0);
  const visibleId = useRef<string | undefined>(undefined);
  const note = plan?.notes.find((item) => item.id === current?.noteId);
  useBlocker({
    shouldBlockFn: () => {
      if (pending) {
        toast.show(t('study.waitForSave'));
        return true;
      }
      return false;
    },
    enableBeforeUnload: pending > 0,
  });

  function next() {
    const step = takeNextSessionCard(
      queue.current,
      new Date(),
      Date.now() - started.current,
      budget.current,
    );
    queue.current = step.queue;
    setMorePlanned(step.queue.planned.length > 0);
    setElapsedMinutes(Math.round((Date.now() - started.current) / 6000) / 10);
    visibleId.current = step.card?.id;
    setCurrent(step.card ? cards.current.get(step.card.id) : undefined);
    setReason(step.card ? '' : step.reason);
    setRevealed(false);
    setInteraction((value) => value + 1);
    setTyped('');
    setTypingReady(false);
    shown.current = Date.now();
    locked.current = false;
  }

  async function start() {
    if (locked.current) return;
    locked.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const result =
        initialPlan ??
        dailyStudySessionSchema.parse(
          await request('/study/session', {
            method: 'POST',
            body: minutes ? { minutes: Number(minutes) } : {},
          }),
        );
      const supported = result.cards;
      cards.current = new Map(supported.map((card) => [card.id, card]));
      queue.current = { planned: supported.map(workloadCard), retries: [], retryMayRun: false };
      setPlan(result);
      setNextDue(result.nextDue);
      budget.current = result.budgetMinutes;
      started.current = Date.now();
      next();
    } catch (cause) {
      setError(cause);
      locked.current = false;
    } finally {
      setLoading(false);
    }
  }

  const initial = useRef(false);
  useEffect(() => {
    if (!initial.current) {
      initial.current = true;
      void start();
    }
  });

  function updateNextDue() {
    const future = [...cards.current.values()]
      .map(
        (card) =>
          projectedDue.current.get(card.id) ??
          studyAvailableAt(workloadCard(card).scheduling, config).toISOString(),
      )
      .filter((due) => new Date(due).getTime() > Date.now());
    if (plan?.nextDue && !plan.cards.some((card) => card.due === plan.nextDue))
      future.push(plan.nextDue);
    setNextDue(future.sort()[0] ?? null);
  }

  async function flushTransport() {
    if (transportBusy.current) return;
    transportBusy.current = true;
    try {
      while (transport.current[0]) {
        const task = transport.current[0];
        try {
          if (task.kind === 'answer') {
            const result = await request<{ card: StudyCard }>('/reviews', {
              method: 'POST',
              body: task.entry.answer,
            });
            confirmedAnswers.current.set(task.entry.answer.id, result.card);
            if (history.current.some((entry) => entry.answer.id === task.entry.answer.id)) {
              await client.cancelQueries({ queryKey: ['study-plan'] });
              await client.cancelQueries({ queryKey: ['decks'] });
              projectConfirmedReview(client, task.entry.card, result.card, new Date());
              projectedAnswers.current.add(task.entry.answer.id);
            }
          } else {
            const reverted = await request<{ card: StudyCard }>('/reviews/undo', {
              method: 'POST',
              body: { id: task.id, reviewId: task.entry.answer.id },
            });
            if (projectedAnswers.current.delete(task.entry.answer.id)) {
              await client.cancelQueries({ queryKey: ['decks'] });
              projectConfirmedReview(
                client,
                confirmedAnswers.current.get(task.entry.answer.id) ?? task.entry.card,
                reverted.card,
                new Date(),
              );
            }
            client.removeQueries({ queryKey: ['study-plan'], type: 'inactive' });
          }
          transport.current.shift();
          setPending(transport.current.length);
          setTransportError(undefined);
          void client.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
          void client.invalidateQueries({ queryKey: ['decks'], refetchType: 'none' });
          void client.invalidateQueries({ queryKey: ['notes'], refetchType: 'none' });
        } catch (cause) {
          setTransportError(cause);
          break;
        }
      }
    } finally {
      transportBusy.current = false;
    }
  }

  function enqueue(task: Transport) {
    transport.current.push(task);
    setPending(transport.current.length);
    void flushTransport();
  }

  function grade(index: number) {
    if (
      !current ||
      current.id !== visibleId.current ||
      !revealed ||
      locked.current ||
      transportError
    )
      return;
    locked.current = true;
    const answer: Answer = {
      id: uuidV7(),
      cardId: current.id,
      rating: RATINGS[index]!,
      reviewedAt: new Date().toISOString(),
      durationMs: Math.min(3_600_000, Math.max(0, Date.now() - shown.current)),
    };
    const entry: SessionAnswer = {
      answer,
      card: current,
      queue: queue.current,
      priorDue: projectedDue.current.get(current.id),
    };
    history.current.push(entry);
    setHistoryCount(history.current.length);
    setRatings((values) => ({ ...values, [answer.rating]: (values[answer.rating] ?? 0) + 1 }));
    setAnswered((count) => count + 1);
    setAnsweredCards((counts) => ({
      ...counts,
      [answer.cardId]: (counts[answer.cardId] ?? 0) + 1,
    }));
    const predicted = review(
      workloadCard(current).scheduling,
      (index + 1) as Rating,
      new Date(answer.reviewedAt),
      config,
      createSeededRandom(seedFromReviewId(answer.id)),
      answer.durationMs,
    );
    const nextCard: StudyCard = {
      ...current,
      state: predicted.next.state,
      due: predicted.next.due.toISOString(),
      stability: predicted.next.stability ?? null,
      difficulty: predicted.next.difficulty ?? null,
      lastReview: predicted.next.lastReview?.toISOString() ?? null,
      reps: predicted.next.reps,
      lapses: predicted.next.lapses,
      learningStep: predicted.next.learningStep,
    };
    cards.current.set(current.id, nextCard);
    queue.current = queueSessionRetry(queue.current, workloadCard(nextCard));
    projectedDue.current.set(current.id, studyAvailableAt(predicted.next, config).toISOString());
    updateNextDue();
    next();
    enqueue({ kind: 'answer', entry });
  }

  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    setHistoryCount(history.current.length);
    setAnswered((count) => count - 1);
    setAnsweredCards((counts) => ({
      ...counts,
      [previous.card.id]: Math.max(0, (counts[previous.card.id] ?? 0) - 1),
    }));
    setRatings((values) => ({
      ...values,
      [previous.answer.rating]: Math.max(0, (values[previous.answer.rating] ?? 0) - 1),
    }));
    queue.current = previous.queue;
    setMorePlanned(queue.current.planned.length > 0);
    cards.current.set(previous.card.id, previous.card);
    if (previous.priorDue) projectedDue.current.set(previous.card.id, previous.priorDue);
    else projectedDue.current.delete(previous.card.id);
    updateNextDue();
    visibleId.current = previous.card.id;
    setCurrent(previous.card);
    setInteraction((value) => value + 1);
    setTyped('');
    setRevealed(true);
    setTypingReady(false);
    setReason('');
    locked.current = false;
    enqueue({ kind: 'undo', entry: previous, id: uuidV7() });
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.repeat || transportError) return;
      if (event.code === 'Space' && current && note) {
        event.preventDefault();
        setRevealed(true);
      }
      if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        grade(Number(event.key) - 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const intervals = current
    ? preview(workloadCard(current).scheduling, new Date(), config)
    : undefined;
  const scheduledFace =
    note && current
      ? possibleCards(note.noteType, note.fields as NoteFields).find(
          (card) => card.direction === current.direction && card.slot === current.slot,
        )
      : undefined;
  const face = note && scheduledFace ? displayedFace(note, scheduledFace, display) : undefined;

  const language = note
    ? (settingsFor(decks.data ?? [], note.deckId).targetLanguage ??
      account.data?.settings.targetLanguage)
    : undefined;
  const typedAnswer =
    current?.direction === 'listening'
      ? String(note?.fields['term'] ?? '')
      : current?.direction === 'production' && face?.back.length === 1
        ? face.back[0]?.value
        : undefined;
  if (practicing && plan)
    return <Practice notes={plan.notes} onFinish={() => setPracticing(false)} />;
  const completed = Object.values(answeredCards).filter((count) => count > 0).length;
  const total = plan?.cards.length ?? 0;
  return (
    <section
      data-screen=""
      data-learning-screen=""
      data-typing-ready={typingReady || undefined}
      className="neu-session flex flex-col gap-16"
    >
      <ModeHeader
        title={t('today.study')}
        exitLabel={t('study.stop')}
        onExit={onFinish}
        disabled={pending > 0}
        value={completed}
        max={total}
        action={
          historyCount > 0 && (
            <Button
              variant="text"
              className="w-44 text-secondary"
              aria-label={t('study.undo')}
              title={t('study.undo')}
              onClick={undo}
            >
              <Undo2 size={20} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          )
        }
      />
      {!!transportError && (
        <ErrorState
          message={t('study.saveFailed')}
          retryLabel={t('common.retry')}
          onRetry={() => void flushTransport()}
        />
      )}
      {!!error && (
        <ErrorState
          message={t(describe(error).key, describe(error).values)}
          retryLabel={t('common.retry')}
          onRetry={() => void start()}
        />
      )}
      {loading && <SkeletonRows rows={3} />}
      {current && (
        <>
          {face ? (
            <LearningCard
              key={`${current.id}:${interaction}`}
              identity={current.id}
              answerFocused={current.direction === 'listening'}
              context={t(`study.direction.${current.direction}`)}
              prompt={
                current.direction === 'listening' ? (
                  <ListeningPrompt
                    key={current.id}
                    text={String(note?.fields['term'] ?? '')}
                    language={language}
                  />
                ) : (
                  face.front.map((line) => (
                    <p key={line.field}>
                      {line.value}
                      {line.field === 'term' && (
                        <Speaker
                          key={`${current.id}:${revealed}`}
                          text={line.value}
                          language={language}
                        />
                      )}
                    </p>
                  ))
                )
              }
              response={
                typedAnswer ? (
                  <TypedResponse
                    key={current.id}
                    value={typed}
                    onChange={setTyped}
                    answer={typedAnswer}
                    language={language}
                    alternatives={
                      Array.isArray(note?.fields['acceptedAnswers'])
                        ? note.fields['acceptedAnswers'].filter(
                            (value): value is string => typeof value === 'string',
                          )
                        : []
                    }
                    revealed={revealed}
                    onReveal={() => setRevealed(true)}
                    ready={typingReady}
                    onReadyChange={setTypingReady}
                  />
                ) : undefined
              }
              answer={
                revealed && note && scheduledFace ? (
                  <RevealedStudyContent
                    note={note}
                    face={scheduledFace}
                    display={display}
                    language={language}
                    identity={`${current.id}:${interaction}`}
                  />
                ) : undefined
              }
            />
          ) : (
            <EmptyState title={t('study.unavailable')} description={t('study.unavailableBody')} />
          )}
          <div className="neu-learning-actions mt-auto flex min-h-[72px] flex-col justify-end gap-8">
            {revealed && intervals ? (
              <div className="neu-reveal grid grid-cols-4 gap-8">
                {RATINGS.map((rating, index) => {
                  const days = intervals[(index + 1) as Rating].intervalDays;
                  return (
                    <Button
                      key={rating}
                      layout="stacked"
                      disabled={!!transportError}
                      className="min-w-0 border-strong px-4 py-8 text-primary"
                      onClick={() => grade(index)}
                    >
                      <span>{t(`study.${rating}`)}</span>
                      <span
                        className="whitespace-nowrap text-12 font-normal text-tertiary"
                        data-numeric=""
                      >
                        {days < 1
                          ? t('study.intervalMinutes', {
                              count: Math.max(1, Math.round(days * 1440)),
                            })
                          : t('study.intervalDays', { count: Math.round(days) })}
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <Button
                full
                variant={typedAnswer ? 'quiet' : 'primary'}
                disabled={!face || !!transportError}
                onClick={() => setRevealed(true)}
              >
                {t('study.reveal')}
              </Button>
            )}
          </div>
        </>
      )}
      {plan && !current && (
        <Card className="flex flex-col gap-16">
          <h2 className="text-20 text-primary">
            {t(answered ? 'study.complete' : 'today.emptyTitle')}
          </h2>
          <p className="text-14 text-secondary">
            {t(
              reason === 'retryNotDue'
                ? 'study.retryLater'
                : answered
                  ? 'study.answered'
                  : 'today.emptyBody',
              { count: answered },
            )}
          </p>
          <p className="text-13 text-secondary">
            {t('study.summaryTime', {
              minutes: elapsedMinutes,
            })}
          </p>
          <p className="text-13 text-secondary">
            {RATINGS.map((rating) => `${t(`study.${rating}`)} ${ratings[rating] ?? 0}`).join(' · ')}
          </p>
          {nextDue && (
            <p className="text-13 text-secondary">
              {t('today.nextReview')}
              <br />
              <ReviewTime due={nextDue} />
            </p>
          )}
          <Button
            full
            variant="primary"
            disabled={pending > 0}
            busy={pending > 0}
            aria-label={t('study.finish')}
            onClick={onFinish}
          >
            {t('study.finish')}
          </Button>
          {morePlanned && (
            <Button
              full
              disabled={pending > 0}
              onClick={() => {
                started.current = Date.now();
                next();
              }}
            >
              {t('study.continue')}
            </Button>
          )}
          {plan.notes.length > 0 && (
            <Button
              disabled={pending > 0}
              onClick={() => {
                history.current = [];
                setHistoryCount(0);
                setPracticing(true);
              }}
            >
              {t('practice.title')}
            </Button>
          )}
        </Card>
      )}
      {!plan && <Button onClick={onFinish}>{t('common.back')}</Button>}
    </section>
  );
}
