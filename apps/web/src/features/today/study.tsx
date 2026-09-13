import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import {
  createSchedulerConfig,
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
import { noteQuery, useNote } from '../../lib/notes';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { useToast } from '../../ui/toast';

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
}: {
  readonly minutes: string;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const toast = useToast();
  const client = useQueryClient();
  const account = useAccount();
  const [plan, setPlan] = useState<DailyStudySession>();
  const [current, setCurrent] = useState<StudyCard>();
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [failed, setFailed] = useState<Answer[]>([]);
  const [pending, setPending] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [reason, setReason] = useState('');
  const queue = useRef<SessionQueue>({ planned: [], retries: [], retryMayRun: false });
  const cards = useRef(new Map<string, StudyCard>());
  const started = useRef(0);
  const shown = useRef(0);
  const locked = useRef(false);
  const budget = useRef(0);
  const visibleId = useRef<string | undefined>(undefined);
  const note = useNote(current?.noteId);
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
    visibleId.current = step.card?.id;
    setCurrent(step.card ? cards.current.get(step.card.id) : undefined);
    setReason(step.card ? '' : step.reason);
    setRevealed(false);
    shown.current = Date.now();
    locked.current = false;
    for (const card of queue.current.planned.slice(0, 4))
      void client.prefetchQuery(noteQuery(card.noteId));
  }

  async function start() {
    if (locked.current) return;
    locked.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const result = dailyStudySessionSchema.parse(
        await request('/study/session', {
          method: 'POST',
          body: minutes ? { minutes: Number(minutes) } : {},
        }),
      );
      // Unsupported interaction directions stay outside this first reveal-only loop.
      const supported = result.cards.filter((card) => card.direction !== 'listening');
      cards.current = new Map(supported.map((card) => [card.id, card]));
      queue.current = { planned: supported.map(workloadCard), retries: [], retryMayRun: false };
      setPlan(result);
      budget.current = result.budgetMinutes;
      started.current = Date.now();
      for (const card of supported.slice(0, 8)) void client.prefetchQuery(noteQuery(card.noteId));
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

  async function submit(answer: Answer) {
    setPending((count) => count + 1);
    try {
      const result = await request<{ card: StudyCard }>('/reviews', {
        method: 'POST',
        body: answer,
      });
      cards.current.set(result.card.id, result.card);
      queue.current = queueSessionRetry(queue.current, workloadCard(result.card));
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
    setAnswered((count) => count + 1);
    next();
    void submit(answer);
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.repeat || failed.length) return;
      if (event.code === 'Space' && current && note.data) {
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

  const config = createSchedulerConfig({
    timezone: account.data?.timezone ?? 'UTC',
    dayCutoffHour: account.data?.dayCutoffHour ?? 4,
    ...(account.data?.settings.targetRetention === undefined
      ? {}
      : { desiredRetention: account.data.settings.targetRetention }),
  });
  const intervals = current
    ? preview(workloadCard(current).scheduling, new Date(), config)
    : undefined;
  const face =
    note.data && current
      ? possibleCards(note.data.note.noteType, note.data.note.fields as NoteFields).find(
          (card) => card.direction === current.direction && card.slot === current.slot,
        )
      : undefined;

  return (
    <section data-screen="" className="flex min-h-[65dvh] flex-col gap-20">
      <h1 className="font-display text-24 text-primary">{t('today.study')}</h1>
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
          onRetry={() => void start()}
        />
      )}
      {loading && <SkeletonRows rows={3} />}
      {current && (
        <>
          <p className="text-13 text-secondary" data-numeric="">
            {t('study.answered', { count: answered })}
          </p>
          {note.isPending ? (
            <SkeletonRows rows={3} />
          ) : note.error ? (
            <ErrorState
              message={t(describe(note.error).key, describe(note.error).values)}
              retryLabel={t('common.retry')}
              onRetry={() => void note.refetch()}
            />
          ) : face ? (
            <Card className="flex flex-1 flex-col justify-center gap-24">
              <div className="text-24 leading-body text-primary">
                {face.front.map((line) => (
                  <p key={line.field}>{line.value}</p>
                ))}
              </div>
              {revealed && (
                <div className="neu-reveal border-t border-subtle pt-20 text-20 leading-body text-primary">
                  {face.back.map((line) => (
                    <p key={line.field}>{line.value}</p>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <EmptyState title={t('study.unavailable')} description={t('study.unavailableBody')} />
          )}
          <div className="mt-auto pb-20">
            {revealed && intervals ? (
              <div className="grid grid-cols-4 gap-8">
                {RATINGS.map((rating, index) => {
                  const days = intervals[(index + 1) as Rating].intervalDays;
                  return (
                    <Button
                      key={rating}
                      disabled={failed.length > 0}
                      className="min-h-64 flex-col gap-4 px-4"
                      onClick={() => grade(index)}
                    >
                      <span>{t(`study.${rating}`)}</span>
                      <span className="text-12" data-numeric="">
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
          <Button
            full
            variant="primary"
            disabled={pending > 0 || failed.length > 0}
            onClick={onFinish}
          >
            {t(pending ? 'common.loading' : 'study.finish')}
          </Button>
          <Button
            full
            disabled={pending > 0 || failed.length > 0}
            onClick={() => {
              started.current = Date.now();
              if (queue.current.planned.length || queue.current.retries.length) next();
              else void start();
            }}
          >
            {t('study.continue')}
          </Button>
        </Card>
      )}
      {!plan && <Button onClick={onFinish}>{t('common.back')}</Button>}
    </section>
  );
}
