import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  availableForStudy,
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
import { checkTypedAnswer, dailyStudySessionSchema, possibleCards, uuidV7 } from '@neuron/shared';
import type { Card as StudyCard, DailyStudySession, NoteFields } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { settingsFor, useDeckTree } from '../../lib/decks';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Input } from '../../ui/input';
import { LearningCard } from '../../ui/learning-card';
import { ModeHeader } from '../../ui/mode-header';
import { ReviewTime } from '../../ui/review-time';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';

import { ListeningPrompt } from './listening-prompt';
import { Practice } from './practice';

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
const RATINGS = ['again', 'hard', 'good', 'easy'] as const;

export function StudyScreen({
  onFinish,
  minutes,
  initialPlan,
}: {
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
  const [failed, setFailed] = useState<Answer[]>([]);
  const [pending, setPending] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [answeredCards, setAnsweredCards] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [morePlanned, setMorePlanned] = useState(false);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [practicing, setPracticing] = useState(false);
  const [last, setLast] = useState<{ answer: Answer; card: StudyCard; queue: SessionQueue }>();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const operations = useRef(new Map<string, Promise<void>>());
  const cancelled = useRef(new Set<string>());
  const undoOperation = useRef<Promise<void> | undefined>(undefined);
  const retryUndo = useRef<(() => Promise<void>) | undefined>(undefined);
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
      if (pending || failed.length) {
        toast.show(t('study.waitForSave'));
        return true;
      }
      return false;
    },
    enableBeforeUnload: pending > 0 || failed.length > 0,
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
    setTyped('');
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

  async function submit(answer: Answer) {
    setPending((count) => count + 1);
    try {
      const result = await request<{ card: StudyCard }>('/reviews', {
        method: 'POST',
        body: answer,
      });
      if (!cancelled.current.has(answer.id)) {
        cards.current.set(result.card.id, result.card);
        queue.current = queueSessionRetry(queue.current, workloadCard(result.card));
        projectedDue.current.delete(result.card.id);
        updateNextDue();
        client.setQueriesData<DailyStudySession>({ queryKey: ['study-plan'] }, (cached) => {
          if (!cached || !cached.cards.some((card) => card.id === result.card.id)) return cached;
          const available = availableForStudy(
            workloadCard(result.card).scheduling,
            new Date(),
            config,
          );
          const nextCards = cached.cards.flatMap((card) =>
            card.id === result.card.id ? (available ? [result.card] : []) : [card],
          );
          return {
            ...cached,
            cards: nextCards,
            availableCount: Math.max(0, cached.availableCount - (available ? 0 : 1)),
            newCount: nextCards.filter((card) => card.state === 'new').length,
            reviewCount: nextCards.filter((card) => card.state !== 'new').length,
            nextDue: available
              ? cached.nextDue
              : ([
                  cached.nextDue,
                  studyAvailableAt(workloadCard(result.card).scheduling, config).toISOString(),
                ]
                  .filter((due): due is string => !!due)
                  .sort()[0] ?? null),
          };
        });
      }
      setFailed((items) => items.filter((item) => item.id !== answer.id));
      void client.invalidateQueries({ queryKey: ['decks'], refetchType: 'none' });
      void client.invalidateQueries({ queryKey: ['notes'], refetchType: 'none' });
    } catch {
      setFailed((items) => [...items.filter((item) => item.id !== answer.id), answer]);
    } finally {
      setPending((count) => count - 1);
    }
  }

  function grade(index: number) {
    if (
      !current ||
      current.id !== visibleId.current ||
      !revealed ||
      locked.current ||
      failed.length
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
    setLast({ answer, card: current, queue: queue.current });
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
    projectedDue.current.set(current.id, studyAvailableAt(predicted.next, config).toISOString());
    updateNextDue();
    next();
    const saving = (undoOperation.current ?? Promise.resolve()).then(() => submit(answer));
    operations.current.set(answer.id, saving);
  }

  function undo() {
    if (!last || undoOperation.current) return;
    const previous = last;
    cancelled.current.add(previous.answer.id);
    setLast(undefined);
    setAnswered((count) => count - 1);
    setAnsweredCards((counts) => ({
      ...counts,
      [previous.card.id]: Math.max(0, (counts[previous.card.id] ?? 0) - 1),
    }));
    setRatings((values) => ({
      ...values,
      [previous.answer.rating]: Math.max(0, (values[previous.answer.rating] ?? 0) - 1),
    }));
    queue.current = {
      ...previous.queue,
      retries: queue.current.retries.filter((card) => card.id !== previous.card.id),
    };
    cards.current.set(previous.card.id, previous.card);
    projectedDue.current.delete(previous.card.id);
    updateNextDue();
    visibleId.current = previous.card.id;
    setCurrent(previous.card);
    setRevealed(true);
    locked.current = false;
    setPending((count) => count + 1);
    const body = { id: uuidV7(), reviewId: previous.answer.id };
    let resolveUndo!: () => void;
    undoOperation.current = new Promise<void>((resolve) => {
      resolveUndo = resolve;
    });
    let attempting = false;
    const attempt = async () => {
      if (attempting) return;
      attempting = true;
      try {
        await operations.current.get(previous.answer.id);
        await request('/reviews', { method: 'POST', body: previous.answer });
        await request('/reviews/undo', { method: 'POST', body });
        void client.invalidateQueries({ queryKey: ['study-plan'], refetchType: 'none' });
        void client.invalidateQueries({ queryKey: ['notes'], refetchType: 'none' });
        void client.invalidateQueries({ queryKey: ['decks'], refetchType: 'none' });
        setFailed((items) => items.filter((item) => item.id !== previous.answer.id));
        setError(undefined);
        locked.current = false;
        retryUndo.current = undefined;
        undoOperation.current = undefined;
        setPending((count) => count - 1);
        resolveUndo();
      } catch (cause) {
        setError(cause);
        locked.current = true;
      } finally {
        attempting = false;
      }
    };
    retryUndo.current = attempt;
    void attempt();
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.repeat || failed.length) return;
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
  const face =
    note && current
      ? possibleCards(note.noteType, note.fields as NoteFields).find(
          (card) => card.direction === current.direction && card.slot === current.slot,
        )
      : undefined;

  const language = note
    ? (settingsFor(decks.data ?? [], note.deckId).targetLanguage ??
      account.data?.settings.targetLanguage)
    : undefined;
  const typedAnswer =
    current?.direction === 'production' && face?.back.length === 1
      ? face.back[0]?.value
      : undefined;
  const feedback =
    typedAnswer && revealed && typed
      ? checkTypedAnswer(
          typed,
          typedAnswer,
          Array.isArray(note?.fields['acceptedAnswers'])
            ? note.fields['acceptedAnswers'].filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
          language,
        )
      : undefined;

  if (practicing && plan)
    return <Practice notes={plan.notes} onFinish={() => setPracticing(false)} />;
  const completed = Object.values(answeredCards).filter((count) => count > 0).length;
  const total = plan?.cards.length ?? 0;
  return (
    <section
      data-screen=""
      className="flex min-h-[calc(100dvh-var(--bar-height)-var(--safe-top)-var(--safe-bottom)-52px)] flex-col gap-16"
    >
      <ModeHeader
        title={t('today.study')}
        exitLabel={t('study.stop')}
        onExit={onFinish}
        disabled={pending > 0 || failed.length > 0}
        value={completed}
        max={total}
        action={
          last && (
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
      {failed.length > 0 && (
        <ErrorState
          message={t('study.saveFailed')}
          retryLabel={t('common.retry')}
          onRetry={() => {
            if (!pending) for (const answer of failed) void submit(answer);
          }}
        />
      )}
      {!!error && (
        <ErrorState
          message={t(describe(error).key, describe(error).values)}
          retryLabel={t('common.retry')}
          onRetry={() => void (retryUndo.current ? retryUndo.current() : start())}
        />
      )}
      {loading && <SkeletonRows rows={3} />}
      {current && (
        <>
          {face ? (
            <LearningCard
              identity={current.id}
              context={t(`study.direction.${current.direction}`)}
              prompt={
                current.direction === 'listening' ? (
                  <ListeningPrompt
                    key={current.id}
                    text={String(note?.fields['term'] ?? '')}
                    language={language}
                  />
                ) : (
                  face.front.map((line) => <p key={line.field}>{line.value}</p>)
                )
              }
              answer={
                revealed ? face.back.map((line) => <p key={line.field}>{line.value}</p>) : undefined
              }
            />
          ) : (
            <EmptyState title={t('study.unavailable')} description={t('study.unavailableBody')} />
          )}
          {typedAnswer && (
            <form
              className="flex flex-col gap-8"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed.trim()) {
                  setRevealed(true);
                  (
                    event.currentTarget.elements.namedItem(
                      'study-answer',
                    ) as HTMLInputElement | null
                  )?.blur();
                }
              }}
            >
              <label className="text-14 text-secondary" htmlFor="study-answer">
                {t('study.typeAnswer')}
              </label>
              <Input
                id="study-answer"
                name="study-answer"
                readOnly={revealed}
                value={typed}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="done"
                onChange={(event) => setTyped(event.target.value)}
              />
              <div className="min-h-44">
                {revealed ? (
                  <p role="status" className="neu-reveal text-14 text-secondary">
                    {feedback ? t(`study.feedback.${feedback}`) : ''} {t('study.chooseRating')}
                  </p>
                ) : (
                  <Button full type="submit" variant="primary" disabled={!typed.trim()}>
                    {t('study.checkAnswer')}
                  </Button>
                )}
              </div>
            </form>
          )}
          <div className="mt-auto flex min-h-[104px] flex-col justify-end gap-8">
            {revealed && intervals ? (
              <div className="neu-reveal grid grid-cols-4 gap-8">
                {RATINGS.map((rating, index) => {
                  const days = intervals[(index + 1) as Rating].intervalDays;
                  return (
                    <Button
                      key={rating}
                      layout="stacked"
                      disabled={failed.length > 0}
                      className="min-w-0 px-4 py-8"
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
                variant="primary"
                disabled={!face || failed.length > 0}
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
            disabled={pending > 0 || failed.length > 0}
            busy={pending > 0}
            aria-label={t('study.finish')}
            onClick={onFinish}
          >
            {t('study.finish')}
          </Button>
          {morePlanned && (
            <Button
              full
              disabled={pending > 0 || failed.length > 0}
              onClick={() => {
                started.current = Date.now();
                next();
              }}
            >
              {t('study.continue')}
            </Button>
          )}
          {plan.notes.length > 0 && (
            <Button disabled={pending > 0 || failed.length > 0} onClick={() => setPracticing(true)}>
              {t('practice.title')}
            </Button>
          )}
        </Card>
      )}
      {!plan && <Button onClick={onFinish}>{t('common.back')}</Button>}
    </section>
  );
}
