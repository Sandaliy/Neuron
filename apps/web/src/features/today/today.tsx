import { keepPreviousData, useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { DEFAULT_ANSWER_SECONDS, dayIndexOf } from '@neuron/core';
import { dailyStudySessionSchema, studyDecks } from '@neuron/shared';
import type { DeckNode, DailyStudySession, MessageKey, LanguageCode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { flatten, settingsFor, useDeckActions, useDeckTree } from '../../lib/decks';
import { useLearningNavigation } from '../../lib/learning-navigation';
import { useReturnScroll } from '../../lib/return-scroll';
import { awaitInitialPlan, confirmedInitialPlan } from '../../lib/study-plan';
import { Button } from '../../ui/button';
import { Card, GroupLabel } from '../../ui/card';
import { Chip } from '../../ui/chip';
import { Dialog, DialogBody } from '../../ui/dialog';
import { Disclosure } from '../../ui/disclosure';
import { ReviewTime } from '../../ui/review-time';
import { Row } from '../../ui/row';
import { Select } from '../../ui/select';
import { ErrorState, Skeleton } from '../../ui/states';
import { useToast } from '../../ui/toast';
import { DeckSettingsDialog } from '../library/deck-dialogs';

import { CardDisplaySetup } from './card-display';
import { ListeningSetup, useListeningAvailability } from './listening-setup';
import { StudyScreen } from './study';
import { useStudyDraft } from './study-draft';
import { StudyScope } from './study-scope';

import type { CardDisplay } from './card-display';
import type { StudyPlanProjection } from '../../lib/note-projection';

/**
 * How long the cards waiting are likely to take.
 *
 * The workload manager in `packages/core` works this out from measured answer
 * times, and measuring needs the review log. The client has no local review log
 * until sync lands in phase 8, so until then this is the same arithmetic over
 * the package's default seconds per answer rather than over this person's.
 *
 * One number rather than one per direction, because the deck tree carries a
 * total and not a breakdown. `recall` is the middle of the five defaults and
 * the direction most of a vocabulary collection is made of.
 *
 * It says "about" on screen for exactly these reasons. When the log is local,
 * `estimateAnswerTimes` replaces the constant and nothing else here changes.
 *
 * @param due cards waiting
 * @returns whole minutes, never less than one when there is anything to do
 */
export function estimateMinutes(due: number): number {
  if (due === 0) {
    return 0;
  }

  return Math.max(1, Math.round((due * DEFAULT_ANSWER_SECONDS.recall) / 60));
}

export function TodayScreen() {
  const t = useTranslate();
  const decks = useDeckTree();
  const learning = useLearningNavigation('study');
  const { draft, change, finish } = useStudyDraft();
  const [studying, setStudying] = useState<DailyStudySession>();
  const rememberScroll = useReturnScroll(learning.active);
  const { minutes } = draft;
  const choices = draft;
  const setChoices = (value: StudyChoices) => change({ ...draft, ...value });
  const wasActive = useRef(learning.active);
  useEffect(() => {
    if (wasActive.current && !learning.active) {
      finish();
      setStudying(undefined);
    }
    wasActive.current = learning.active;
  }, [learning.active, finish]);
  useEffect(
    () => () => {
      if (wasActive.current) finish();
    },
    [finish],
  );
  if (learning.active)
    return (
      <StudyScreen
        {...(studying ? { initialPlan: studying } : {})}
        minutes={minutes}
        display={choices.display}
        requestChoices={{
          ...(choices.direction
            ? {
                direction: choices.direction as
                  'recognition' | 'recall' | 'production' | 'listening',
              }
            : {}),
          ...(choices.language === undefined ? {} : { targetLanguage: choices.language }),
          ...(choices.scope === undefined
            ? {}
            : {
                deckIds: choices.scope.filter((id) =>
                  flatten(decks.data ?? []).some((deck) => deck.id === id && deck.kind === 'deck'),
                ),
              }),
          ...(draft.override ? { newCards: 'override' } : {}),
        }}
        onFinish={() => {
          learning.exit();
        }}
      />
    );
  return (
    <section data-screen="" className="flex flex-col gap-24">
      <header className="flex flex-col gap-4">
        <time className="text-12 text-secondary" dateTime={new Date().toISOString()}>
          {new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(
            new Date(),
          )}
        </time>
        <h1 className="text-32 tracking-tight text-primary">{t('today.title')}</h1>
      </header>
      {decks.isPending && <Skeleton className="h-56 w-full" />}
      {decks.error && !decks.data && (
        <ErrorState
          message={t(describe(decks.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void decks.refetch()}
        />
      )}
      {decks.data && (
        <Waiting
          minutes={minutes}
          onMinutes={(minutes) => change({ ...draft, minutes })}
          decks={decks.data}
          onStart={(plan) => {
            rememberScroll();
            setStudying(plan);
            void learning.open();
          }}
          choices={choices}
          onChoices={setChoices}
        />
      )}
    </section>
  );
}
interface StudyChoices {
  readonly scope?: string[] | undefined;
  readonly language?: LanguageCode | null;
  readonly direction: string;
  readonly display: CardDisplay;
}
function Waiting({
  decks,
  onStart,
  minutes,
  onMinutes,
  choices,
  onChoices,
}: {
  readonly choices: StudyChoices;
  readonly onChoices: (choices: StudyChoices) => void;
  readonly minutes: string;
  readonly onMinutes: (value: string) => void;
  readonly decks: readonly DeckNode[];
  readonly onStart: (plan: DailyStudySession) => void;
}) {
  const t = useTranslate();
  const navigate = useNavigate();
  const toast = useToast();
  const actions = useDeckActions();
  const account = useAccount();
  const client = useQueryClient();
  const { draft, change } = useStudyDraft();
  const present = useRef(true);
  useEffect(() => {
    present.current = true;
    return () => {
      present.current = false;
    };
  }, []);
  const live = studyDecks(flatten(decks));
  const { scope, direction } = choices;
  const [scopeOpen, setScopeOpen] = useState(false);
  const baseSelected =
    scope ??
    live.filter((deck) => deck.settings?.dailyStudyIncluded !== false).map((deck) => deck.id);
  const languageFor = (deck: DeckNode) =>
    settingsFor(decks, deck.id).targetLanguage ?? account.data?.settings.targetLanguage ?? null;
  const languages = [
    ...new Set(
      live
        .filter((deck) =>
          baseSelected.length === 0
            ? deck.settings?.dailyStudyIncluded !== false
            : baseSelected.includes(deck.id),
        )
        .map(languageFor),
    ),
  ].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  const language =
    choices.language !== undefined && languages.includes(choices.language)
      ? choices.language
      : (languages[0] ?? (live[0] ? languageFor(live[0]) : null));
  const relevantDecks = live.filter((deck) => languageFor(deck) === language);
  const selected = baseSelected.filter((id) => relevantDecks.some((deck) => deck.id === id));
  const scopeLabel =
    selected.length === 1
      ? (live.find((deck) => deck.id === selected[0])?.name ?? '')
      : t('study.scopeCount', { count: selected.length });
  const mutations = useIsMutating({
    predicate: (mutation) =>
      ['note-interaction', 'study-configuration'].includes(
        String(mutation.options.mutationKey?.[0]),
      ),
  });
  const override = draft.override;
  const setOverride = (override: boolean) => change({ ...draft, override });
  const [skillDeckId, setSkillDeckId] = useState<string>();
  const [skillReviewOpen, setSkillReviewOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const selectedDecks = live.filter((deck) => selected.includes(deck.id));
  const listening = useListeningAvailability(decks, selectedDecks);
  const listeningNeedsSetup =
    direction === 'listening' && listening.some((item) => item.confirmed && !item.voice);
  const planKey = [
    'study-plan',
    minutes,
    direction,
    override,
    scope?.filter((id) => live.some((deck) => deck.id === id)),
    language,
    live.map((deck) => [
      deck.id,
      deck.settings?.dailyStudyIncluded,
      languageFor(deck),
      settingsFor(decks, deck.id).ladder,
    ]),
    account.data?.id,
    account.data?.revision,
  ];
  const planIdentity = JSON.stringify(planKey);
  const defaultRequest = !minutes && !direction && !override && scope === undefined;
  const initial = defaultRequest ? confirmedInitialPlan(client, account.data, language) : undefined;
  const startGeneration = useRef(0);
  useLayoutEffect(() => {
    startGeneration.current++;
  }, [planIdentity]);
  const plan = useQuery<StudyPlanProjection>({
    queryKey: planKey,
    ...(initial ? { initialData: initial.data, initialDataUpdatedAt: initial.updatedAt } : {}),
    queryFn: async ({ signal }) => {
      if (defaultRequest) {
        const early = await awaitInitialPlan(client, account.data, language);
        if (early) return early.data;
      }
      return dailyStudySessionSchema.parse(
        await request('/study/session', {
          method: 'POST',
          signal,
          body: {
            ...(minutes ? { minutes: Number(minutes) } : {}),
            ...(direction ? { direction } : {}),
            ...(override ? { newCards: 'override' } : {}),
            ...(scope === undefined
              ? {}
              : { deckIds: scope.filter((id) => live.some((deck) => deck.id === id)) }),
            targetLanguage: language,
          },
        }),
      );
    },
    // Confirmed plans survive brief route visits. Projections and writes still
    // require server reconciliation; time-sensitive availability bounds reuse.
    staleTime: (query) => {
      const value = query.state.data;
      if (!value || value.localProjection || value.reviewProjection) return 0;
      const boundary = {
        timezone: account.data?.timezone ?? 'UTC',
        dayCutoffHour: account.data?.dayCutoffHour ?? 4,
      };
      if (
        dayIndexOf(new Date(query.state.dataUpdatedAt), boundary) !==
        dayIndexOf(new Date(), boundary)
      )
        return 0;
      return Math.max(
        0,
        Math.min(
          15_000,
          value.nextDue ? Date.parse(value.nextDue) - query.state.dataUpdatedAt : 15_000,
        ),
      );
    },
    placeholderData: keepPreviousData,
    enabled: mutations === 0 && !!account.data,
  });
  const result = plan.data;
  const updating = plan.isPlaceholderData || result?.localProjection === true;
  const reconciling = plan.isPlaceholderData || result?.reviewProjection === true;
  const unsupported = direction
    ? selected.filter(
        (id) =>
          !settingsFor(decks, id).ladder.some(
            (rung) => rung.direction === direction && rung.opensAtStability === 0,
          ),
      )
    : [];
  const singleUnsupported =
    selected.length === 1 && unsupported.length === 1 && result?.cards.length === 0;
  const caughtUp =
    result?.availableCount === 0 && selected.length > 0 && !reconciling && !singleUnsupported;
  const expanded = setupOpen || unsupported.length > 0 || listeningNeedsSetup;
  const setup = live.length > 0 && (
    <Disclosure
      title={t('study.setup')}
      leading={
        <SlidersHorizontal size={18} className="shrink-0 text-secondary" aria-hidden="true" />
      }
      open={expanded}
      onOpenChange={setSetupOpen}
      className="border-t border-subtle pt-12"
      detail={
        !expanded &&
        language && (
          <span className="flex min-w-0 items-center gap-8 text-13 text-secondary">
            <span aria-hidden="true" className="size-4 shrink-0 rounded-full bg-fill-accent" />
            {language ? t(`lang.${language}`) : t('study.unspecifiedLanguage')}
          </span>
        )
      }
    >
      <div className="flex flex-col gap-12">
        {languages.length > 1 && (
          <label className="flex items-center justify-between gap-12 text-13 text-secondary">
            {t('study.language')}
            <Select
              value={language ?? ''}
              onChange={(event) =>
                onChoices({
                  ...choices,
                  language: (event.target.value || null) as LanguageCode | null,
                })
              }
            >
              {languages.map((item) => (
                <option key={item ?? 'unspecified'} value={item ?? ''}>
                  {item ? t(`lang.${item}`) : t('study.unspecifiedLanguage')}
                </option>
              ))}
            </Select>
          </label>
        )}
        <div className="flex items-center justify-between gap-12">
          <span className="text-13 text-secondary">{t('study.scope')}</span>
          <Button variant="text" className="min-w-0 px-8" onClick={() => setScopeOpen(true)}>
            <span className="truncate">{scopeLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-12">
          <label className="flex flex-col justify-between gap-8 text-13 text-secondary">
            {t('study.minutes')}
            <Select value={minutes} onChange={(event) => onMinutes(event.target.value)}>
              <option value="">{t('study.defaultTime')}</option>
              {[5, 10, 20, 30].map((value) => (
                <option key={value} value={value}>
                  {t('study.intervalMinutes', { count: value })}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col justify-between gap-8 text-13 text-secondary">
            {t('study.skill')}
            <Select
              value={direction}
              onChange={(event) => onChoices({ ...choices, direction: event.target.value })}
            >
              <option value="">{t('study.mixed')}</option>
              {(['recognition', 'recall', 'production', 'listening'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`study.direction.${mode}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {unsupported.length > 0 && (
          <div
            role="status"
            className="flex flex-col gap-4 rounded-12 border border-subtle bg-sunken p-12 text-13 text-secondary"
          >
            <p className="text-primary">
              {t(unsupported.length === 1 ? 'study.skillUnavailable' : 'study.skillOff', {
                mode: t(`study.direction.${direction}` as MessageKey),
                count: unsupported.length,
              })}
            </p>
            <p>
              {live
                .filter((deck) => unsupported.includes(deck.id))
                .map((deck) => deck.name)
                .join(', ')}
            </p>
            <Button
              variant="text"
              className="self-start px-8"
              onClick={() =>
                unsupported.length === 1 ? setSkillDeckId(unsupported[0]) : setSkillReviewOpen(true)
              }
            >
              {t(unsupported.length === 1 ? 'study.enableSkill' : 'study.reviewDecks')}
            </Button>
          </div>
        )}
        {(result?.newCards.overrideAvailable || override) && (
          <label className="flex min-h-44 items-center gap-8 text-14 text-secondary">
            <input
              type="checkbox"
              checked={override}
              onChange={(event) => setOverride(event.target.checked)}
            />
            {t('study.moreNew')}
          </label>
        )}
        {direction === 'listening' && (
          <ListeningSetup key={language ?? 'unspecified'} decks={decks} selected={selectedDecks} />
        )}
        <CardDisplaySetup
          notes={result?.notes ?? []}
          value={choices.display}
          onChange={(display) => onChoices({ ...choices, display })}
        />
        {languages.length > 1 && result && (
          <p className="border-t border-subtle pt-12 text-13 text-secondary">
            {updating
              ? t('today.updatingPlan')
              : t('study.aggregateReady', {
                  count: result.aggregateReady,
                  languages: languages.length,
                })}
          </p>
        )}
      </div>
    </Disclosure>
  );
  const waiting = (result?.deckSummaries ?? [])
    .filter((summary) => selected.includes(summary.deckId))
    .flatMap((summary) => {
      const deck = live.find((row) => row.id === summary.deckId);
      return deck ? [{ ...deck, ...summary }] : [];
    });
  return (
    <div data-today-view="" className="flex flex-col gap-24">
      <Card className="flex flex-col gap-24">
        {selected.length === 0 ? (
          <>
            <h2 className="text-24 text-primary">{t('study.noDecks')}</h2>
            <Button onClick={() => setScopeOpen(true)}>{t('study.chooseDecks')}</Button>
          </>
        ) : plan.error && !result ? (
          <ErrorState
            message={t(describe(plan.error).key)}
            retryLabel={t('common.retry')}
            onRetry={() => void plan.refetch()}
          />
        ) : !result ? (
          <div className="flex flex-col gap-20" aria-label={t('common.loading')} role="status">
            <Skeleton className="h-56 w-[60%]" />
            <Skeleton className="h-20 w-[40%]" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : reconciling ? (
          <div role="status" className="flex min-h-112 items-center text-17 text-secondary">
            {t('today.updatingPlan')}
          </div>
        ) : singleUnsupported ? (
          <>
            <h2 className="text-24 text-primary">{t('study.modeUnavailable')}</h2>
          </>
        ) : caughtUp ? (
          <>
            <h2 className="text-24 text-primary">{t('today.caughtUpTitle')}</h2>
            <div className="flex flex-col gap-4" role="status">
              <span className="text-12 text-secondary">{t('today.nextReview')}</span>
              <span className="text-17 text-primary">
                {updating ? (
                  t('today.updatingPlan')
                ) : result.nextDue ? (
                  <ReviewTime due={result.nextDue} />
                ) : (
                  t('today.noneScheduled')
                )}
              </span>
            </div>
            <Button onClick={() => void navigate({ to: '/library' })}>
              {t('today.practiceDeck')}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-end justify-between gap-16">
              <div className="flex items-baseline gap-12">
                <span data-numeric="" className="text-56 leading-none tracking-tight text-primary">
                  {result.cards.length}
                </span>
                <span className="text-17 text-secondary">{t('today.ready')}</span>
              </div>
              <span className="pb-4 text-13 text-secondary">
                {updating
                  ? t('today.updatingPlan')
                  : t('today.estimate', {
                      minutes: Math.max(1, Math.round(result.estimatedMinutes)),
                    })}
              </span>
            </div>
            <div className="flex gap-32 text-13 text-secondary">
              <span>
                <span data-numeric="" className="mr-4 text-15 text-primary">
                  {result.reviewCount}
                </span>
                {t('study.reviewsMetric')}
              </span>
              <span>
                <span data-numeric="" className="mr-4 text-15 text-primary">
                  {result.newCount}
                </span>
                {t('study.newMetric')}
              </span>
            </div>
          </>
        )}
        {setup}
        {selected.length > 0 && result && !reconciling && !singleUnsupported && !caughtUp && (
          <Button
            variant="primary"
            full
            disabled={
              !result.cards.length ||
              (direction === 'listening' && listening.some((item) => !item.language)) ||
              plan.isFetching ||
              plan.isPlaceholderData ||
              mutations > 0 ||
              !!plan.error ||
              result.localProjection === true
            }
            onClick={() => {
              const generation = startGeneration.current;
              const boundary = {
                timezone: account.data?.timezone ?? 'UTC',
                dayCutoffHour: account.data?.dayCutoffHour ?? 4,
              };
              const now = new Date();
              const currentDay =
                dayIndexOf(new Date(plan.dataUpdatedAt), boundary) === dayIndexOf(now, boundary);
              const beforeNextDue = !result.nextDue || Date.parse(result.nextDue) > now.getTime();
              if (
                !plan.isStale &&
                currentDay &&
                beforeNextDue &&
                now.getTime() - plan.dataUpdatedAt < 15_000
              )
                onStart(result);
              else
                void plan.refetch().then((fresh) => {
                  if (
                    present.current &&
                    generation === startGeneration.current &&
                    fresh.isSuccess &&
                    fresh.data &&
                    !fresh.data.localProjection &&
                    !fresh.data.reviewProjection
                  )
                    onStart(fresh.data);
                });
            }}
          >
            {t('today.study')}
          </Button>
        )}
      </Card>
      {plan.error && result && (
        <ErrorState
          message={t(describe(plan.error).key)}
          retryLabel={t('common.retry')}
          onRetry={() => void plan.refetch()}
        />
      )}
      {selected.length > 0 && waiting.length > 0 && (
        <div className="flex flex-col gap-12">
          <GroupLabel>{t(scope === undefined ? 'study.scopeDefault' : 'study.scope')}</GroupLabel>
          <div className="flex flex-col gap-8">
            {waiting.map((deck) => (
              <Row
                key={deck.id}
                title={deck.name}
                onClick={() => void navigate({ to: '/notes', search: { deckId: deck.id } })}
                subtitle={
                  reconciling ? (
                    t('today.updatingPlan')
                  ) : deck.due === 0 && deck.fresh === 0 && deck.nextDue ? (
                    <ReviewTime due={deck.nextDue} />
                  ) : (
                    t('today.deckCounts', { due: deck.due, fresh: deck.fresh })
                  )
                }
                trailing={
                  !reconciling && deck.due > 0 ? <Chip tone="due">{deck.due}</Chip> : undefined
                }
              />
            ))}
          </div>
        </div>
      )}
      <StudyScope
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        decks={relevantDecks}
        collections={flatten(decks)}
        selected={scope}
        onApply={(next) => onChoices({ ...choices, scope: next })}
      />
      <Dialog
        open={skillReviewOpen}
        onOpenChange={setSkillReviewOpen}
        title={t('study.reviewDecks')}
      >
        <DialogBody>
          {live
            .filter((deck) => unsupported.includes(deck.id))
            .map((deck) => (
              <Button
                key={deck.id}
                full
                onClick={() => {
                  setSkillReviewOpen(false);
                  setSkillDeckId(deck.id);
                }}
              >
                {deck.name}
              </Button>
            ))}
        </DialogBody>
      </Dialog>
      {skillDeckId && live.find((deck) => deck.id === skillDeckId) && (
        <DeckSettingsDialog
          open
          onOpenChange={(open) => {
            if (!open) setSkillDeckId(undefined);
          }}
          deck={live.find((deck) => deck.id === skillDeckId)!}
          decks={decks}
          busy={actions.update.isPending}
          onSave={(settings) => {
            void actions.update
              .mutateAsync({ id: skillDeckId, settings })
              .then(() => setSkillDeckId(undefined))
              .catch((error) => toast.show(t(describe(error).key)));
          }}
        />
      )}
    </div>
  );
}
