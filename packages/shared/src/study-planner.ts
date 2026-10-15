import {
  availableForDailyStudy,
  dailyStudyAvailableAt,
  studyDayAnswers,
  buildSession,
  createBudget,
  createSchedulerConfig,
  createSeededRandom,
  createWorkloadConfig,
  dayIndexOf,
  forecast,
} from '@neuron/core';
import type { WorkloadCard, WorkloadReview } from '@neuron/core';

import { resolveDeckSettings } from './deck-settings.js';

import type { DailyStudySessionRequest } from './api/study.js';
import type { DeckSettings, ResolvedDeckSettings } from './deck-settings.js';

export interface PlanningDeck {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly settings?: DeckSettings | null;
}

/** One deterministic planning pipeline for authenticated and downloaded collections. */
export function planDailyStudy(input: {
  readonly account: { id: string; settings: DeckSettings; timezone: string; dayCutoffHour: number };
  readonly collections: readonly PlanningDeck[];
  readonly scopeDeckIds: string[];
  readonly explicitScope: boolean;
  readonly settings: ResolvedDeckSettings;
  readonly cards: readonly WorkloadCard[];
  readonly allLogs: readonly WorkloadReview[];
  readonly body: DailyStudySessionRequest;
  readonly now: Date;
}) {
  const { account, collections, scopeDeckIds, settings, cards, allLogs, body, now } = input;
  const byDeck = new Map(collections.map((deck) => [deck.id, deck]));
  const scope = input.explicitScope ? scopeDeckIds : undefined;
  const selected = new Set(scopeDeckIds);
  const scheduler = createSchedulerConfig({
    timezone: account.timezone,
    dayCutoffHour: account.dayCutoffHour,
    desiredRetention: settings.targetRetention,
  });
  const budget = createBudget({
    minutesByWeekday: settings.budgetMinutes,
    allowCarryOver: settings.allowCarryOver,
  });
  const config = createWorkloadConfig({
    scheduler,
    budget,
    maximumNewCardsPerDay: settings.maximumNewCardsPerDay,
  });
  const languageByDeck = new Map(
    scopeDeckIds.map((id) => {
      const chain: DeckSettings[] = [];
      let deck = byDeck.get(id);
      const seen = new Set<string>();
      while (deck && !seen.has(deck.id)) {
        seen.add(deck.id);
        chain.unshift((deck.settings ?? {}) as DeckSettings);
        deck = byDeck.get(deck.parentId!);
      }
      return [
        id,
        resolveDeckSettings([account.settings, ...chain]).targetLanguage ?? null,
      ] as const;
    }),
  );
  const languages = [...new Set(languageByDeck.values())].sort((a, b) =>
    (a ?? '').localeCompare(b ?? ''),
  );
  const targetLanguage =
    body.targetLanguage === undefined ? (languages[0] ?? null) : body.targetLanguage;
  const sessionDeckIds = scopeDeckIds.filter((id) => languageByDeck.get(id) === targetLanguage);
  const supported = cards.filter(
    (card) =>
      sessionDeckIds.includes(card.deckId!) &&
      (body.direction === undefined || card.direction === body.direction),
  );
  const logs = allLogs.filter(
    (log) => scope === undefined || (log.deckId !== undefined && selected.has(log.deckId)),
  );
  const answers = studyDayAnswers(cards, logs, now, scheduler);
  const available = (card: WorkloadCard) => availableForDailyStudy(card, answers, now, scheduler);
  const nextAt = (card: WorkloadCard) => dailyStudyAvailableAt(card, answers, now, scheduler);
  const future = (pool: readonly WorkloadCard[]) =>
    pool
      .filter(
        (card) =>
          !available(card) && (card.scheduling.state !== 'new' || answers.notes.has(card.noteId)),
      )
      .map((card) => nextAt(card).toISOString())
      .sort()[0] ?? null;
  // Language and skill never own a copy of the account's automatic allowance.
  // Explicit temporary Deck scope retains its existing workload universe.
  const load = forecast({ cards, config, now, logs });
  const sharedRequest = {
    budget,
    config,
    now,
    logs,
    answers,
    load,
    ...(body.minutes === undefined ? {} : { oneOffMinutes: body.minutes }),
    newCardMode: body.newCards,
  };
  const seed = sessionSeed(account.id, scopeDeckIds.join(','), dayIndexOf(now, scheduler));
  const aggregate = buildSession({ ...sharedRequest, cards, rng: createSeededRandom(seed) });
  const session = buildSession({
    ...sharedRequest,
    cards: supported,
    backlog: aggregate.backlog,
    automaticNewCardLimit: aggregate.newCount,
    rng: createSeededRandom(seed),
  });

  return {
    ...session,
    scopeDeckIds: sessionDeckIds,
    targetLanguage,
    languages,
    aggregateReady: aggregate.cards.length,
    deckSummaries: sessionDeckIds.map((deckId) => {
      const pool = supported.filter((card) => card.deckId === deckId);
      return {
        deckId,
        due: pool.filter((card) => card.scheduling.state !== 'new' && available(card)).length,
        fresh: pool.filter((card) => card.scheduling.state === 'new' && available(card)).length,
        nextDue: future(pool),
      };
    }),
    availableCount: supported.filter(available).length,
    nextDue: future(supported),
  };
}

/** Stable per-user, per-scope, per-calendar-day seed for review tie breaking. */
function sessionSeed(userId: string, deckId: string | undefined, day: number): number {
  let seed = 0;
  for (const character of `${userId}:${deckId ?? 'all'}:${day}`)
    seed = (Math.imul(seed, 31) + character.charCodeAt(0)) | 0;
  return seed >>> 0;
}
