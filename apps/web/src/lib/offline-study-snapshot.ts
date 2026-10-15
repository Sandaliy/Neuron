import {
  createSchedulerConfig,
  createSeededRandom,
  newCard,
  projectReviewEvents,
  review,
  reviewProjectionOrigin,
  seedFromReviewId,
} from '@neuron/core';
import type { ReviewEvent, ReviewLog, SchedulingState, WorkloadReview } from '@neuron/core';
import {
  cardSchema,
  dailyStudySessionRequestSchema,
  deckSchema,
  meSchema,
  noteSchema,
  planDailyStudy,
  resolveDeckSettings,
  reviewHistoryRowSchema,
  studyDecks,
  timeZoneSchema,
  dayCutoffHourSchema,
} from '@neuron/shared';
import type {
  Card,
  DailyStudySession,
  DailyStudySessionRequest,
  Me,
  ReviewHistoryRow,
  PullSyncResult,
} from '@neuron/shared';

import { validateReviewIntent } from './review-intent.js';

type CollectionRow = PullSyncResult['changes'][number];

export type OfflineStudyLimit = 'settings' | 'history' | 'recovery' | 'content' | null;
export type OfflineStudyPlan = DailyStudySession & {
  offlineStudy: { limit: OfflineStudyLimit; cursor: number; sequence: number };
};
export interface StudySnapshot {
  account: unknown;
  cursor: number;
  complete: boolean;
  reviewSequence: number;
  decks: CollectionRow[];
  notes: CollectionRow[];
  cards: CollectionRow[];
  reviews: CollectionRow[];
  edits: unknown[];
  events: unknown[];
}

const ratings = ['again', 'hard', 'good', 'easy'] as const;
function instant(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('offline_study_history');
  return date;
}
export function schedulingOf(
  card: Pick<
    Card,
    'state' | 'due' | 'stability' | 'difficulty' | 'lastReview' | 'reps' | 'lapses' | 'learningStep'
  >,
): SchedulingState {
  const counters = {
    due: instant(card.due),
    reps: card.reps,
    lapses: card.lapses,
    learningStep: card.learningStep,
  };
  if (card.reps < 0 || card.lapses < 0 || card.learningStep < 0)
    throw new Error('offline_study_history');
  if (card.state === 'new') return { ...newCard(counters.due), ...counters };
  if (
    card.stability === null ||
    card.stability <= 0 ||
    card.difficulty === null ||
    card.difficulty < 1 ||
    card.difficulty > 10 ||
    !card.lastReview
  )
    throw new Error('offline_study_history');
  return {
    ...counters,
    state: card.state,
    stability: card.stability,
    difficulty: card.difficulty,
    lastReview: instant(card.lastReview),
  };
}
function withScheduling(card: Card, state: SchedulingState): Card {
  return {
    ...card,
    ...state,
    due: state.due.toISOString(),
    lastReview: state.lastReview?.toISOString() ?? null,
    stability: state.stability ?? null,
    difficulty: state.difficulty ?? null,
  };
}
function logOf(row: ReviewHistoryRow): ReviewLog {
  return {
    rating: (ratings.indexOf(row.rating) + 1) as ReviewLog['rating'],
    reviewedAt: row.reviewedAt,
    durationMs: row.durationMs,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    placedDue: row.placedDue,
    stateBefore: row.stateBefore,
    stabilityBefore: row.stabilityBefore ?? undefined,
    difficultyBefore: row.difficultyBefore ?? undefined,
  };
}
function eventOf(row: ReviewHistoryRow): ReviewEvent {
  return {
    id: row.id,
    order: row.rev,
    log: logOf(row),
    resetsLearning: row.resetsLearning,
    cancelsReviewId: row.cancelsReviewId,
    ...(row.priorState ? { priorState: schedulingOf(row.priorState) } : {}),
  };
}
function checkedRows(rows: CollectionRow[], cursor: number) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      ids.has(row.id) ||
      row.id !== row.row['id'] ||
      row.rev !== row.row['rev'] ||
      !Number.isSafeInteger(row.rev) ||
      row.rev < 0 ||
      row.rev > cursor
    )
      throw new Error('offline_study_history');
    ids.add(row.id);
  }
  return rows;
}

/** Read-only projection of existing records. No provisional browse overlays or Card generation. */
export function planDownloadedStudy(
  snapshot: StudySnapshot,
  accountId: string,
  request: Partial<DailyStudySessionRequest>,
  now: Date,
  knownAccount?: Me,
): OfflineStudyPlan {
  if (!snapshot.complete || !Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < 0)
    throw new Error('offline_study_incomplete');
  let account: Me;
  let downloadedAccount: Me;
  try {
    downloadedAccount = meSchema.parse(snapshot.account);
    account = knownAccount ? meSchema.parse(knownAccount) : downloadedAccount;
    timeZoneSchema.parse(account.timezone);
    dayCutoffHourSchema.parse(account.dayCutoffHour);
  } catch {
    throw new Error('offline_study_settings');
  }
  if (account.id !== accountId || downloadedAccount.id !== accountId)
    throw new Error('offline_study_account');
  let limit: OfflineStudyLimit =
    account.revision === snapshot.cursor &&
    downloadedAccount.revision === snapshot.cursor &&
    account.timezone === downloadedAccount.timezone &&
    account.dayCutoffHour === downloadedAccount.dayCutoffHour &&
    JSON.stringify(account.settings) === JSON.stringify(downloadedAccount.settings)
      ? null
      : 'settings';
  const deckRows = checkedRows(snapshot.decks, snapshot.cursor);
  const noteRows = checkedRows(snapshot.notes, snapshot.cursor);
  const retainedDecks = new Set(deckRows.map((row) => row.id));
  const retainedNotes = new Set(noteRows.map((row) => row.id));
  const decks = deckRows
    .filter((row) => !row.deleted && !row.purged)
    .map((row) => deckSchema.parse({ ...row.row, path: [] }));
  const liveDecks = studyDecks(decks);
  const liveIds = new Set(liveDecks.map((deck) => deck.id));
  const notes = new Map(
    noteRows
      .filter((row) => !row.deleted && !row.purged && liveIds.has(String(row.row['deckId'])))
      .map((row) => {
        const note = noteSchema.parse(row.row);
        return [note.id, note] as const;
      }),
  );
  const blocked = new Set<string>();
  const blockedNotes = new Set<string>();
  const cards = new Map<string, Card>();
  const resetAt = new Map<string, Date>();
  const liveCards = new Set<string>();
  for (const row of checkedRows(snapshot.cards, snapshot.cursor)) {
    if (row.purged) {
      limit = 'history';
      continue;
    }
    const card = cardSchema.parse(row.row);
    schedulingOf(card);
    if (!row.deleted && (!retainedDecks.has(card.deckId) || !retainedNotes.has(card.noteId))) {
      limit = 'content';
      blockedNotes.add(card.noteId);
    }
    cards.set(card.id, card);
    if (row.row['resetAt']) resetAt.set(card.id, instant(String(row.row['resetAt'])));
    if (
      !row.deleted &&
      !card.suspendedAt &&
      liveIds.has(card.deckId) &&
      notes.get(card.noteId)?.status === 'active' &&
      notes.get(card.noteId)?.deckId === card.deckId
    )
      liveCards.add(card.id);
  }
  const history = new Map<
    string,
    {
      cardId: string;
      event: ReviewEvent;
      submittedAt: string | null;
      rating: string;
      durationMs: number;
    }
  >();
  const byCard = new Map<string, ReviewEvent[]>();
  const restrictCard = (id: string) => {
    blocked.add(id);
    const card = cards.get(id);
    if (card) blockedNotes.add(card.noteId);
  };
  for (const row of checkedRows(snapshot.reviews, snapshot.cursor)) {
    const parsed = reviewHistoryRowSchema.safeParse(row.row);
    if (row.deleted || row.purged || !parsed.success || !cards.has(String(row.row['cardId']))) {
      limit = 'history';
      restrictCard(String(row.row['cardId']));
      continue;
    }
    const data = parsed.data;
    const event = eventOf(data);
    history.set(data.id, {
      cardId: data.cardId,
      event,
      submittedAt: data.submittedAt?.toISOString() ?? null,
      rating: data.rating,
      durationMs: data.durationMs,
    });
    const list = byCard.get(data.cardId) ?? [];
    list.push(event);
    byCard.set(data.cardId, list);
  }
  for (const { cardId, event } of history.values()) {
    if (event.cancelsReviewId && history.get(event.cancelsReviewId)?.cardId !== cardId) {
      limit = 'history';
      restrictCard(cardId);
    }
  }
  const scheduler = createSchedulerConfig({
    timezone: account.timezone,
    dayCutoffHour: account.dayCutoffHour,
    ...(account.settings.targetRetention === undefined
      ? {}
      : { desiredRetention: account.settings.targetRetention }),
  });
  const lifeEvents = (cardId: string) =>
    (byCard.get(cardId) ?? []).filter(
      (event) => !resetAt.has(cardId) || event.log.reviewedAt >= resetAt.get(cardId)!,
    );
  const origin = (card: Card, events: ReviewEvent[]) =>
    reviewProjectionOrigin(
      events,
      newCard(
        resetAt.get(card.id) ??
          events.toSorted((a, b) => a.log.reviewedAt.getTime() - b.log.reviewedAt.getTime())[0]?.log
            .reviewedAt ??
          instant(card.due),
      ),
    );
  // Settings may have changed since an older answer. The downloaded schedule
  // remains authoritative; complete surviving event counts prove its history
  // without recomputing old memory under a different timezone or retention.
  for (const card of cards.values()) {
    const events = lifeEvents(card.id);
    const cancelled = new Set(
      events.flatMap((event) => (event.cancelsReviewId ? [event.cancelsReviewId] : [])),
    );
    let surviving: ReviewEvent[] = [];
    for (const event of events
      .filter((event) => !event.cancelsReviewId)
      .sort(
        (a, b) =>
          a.log.reviewedAt.getTime() - b.log.reviewedAt.getTime() ||
          (a.order ?? 0) - (b.order ?? 0) ||
          a.id.localeCompare(b.id),
      )) {
      if (event.resetsLearning) surviving = [];
      else if (!cancelled.has(event.id)) surviving.push(event);
    }
    if (
      card.reps !== surviving.length ||
      (card.lastReview !== null &&
        Date.parse(card.lastReview) !== surviving.at(-1)?.log.reviewedAt.getTime())
    ) {
      limit = 'history';
      restrictCard(card.id);
    }
  }
  const entries = snapshot.events
    .map((entry) => validateReviewIntent(entry, accountId))
    .sort((a, b) => a.sequence - b.sequence);
  if (
    !Number.isSafeInteger(snapshot.reviewSequence) ||
    snapshot.reviewSequence !== entries.length ||
    entries.some((entry, index) => entry.sequence !== index + 1)
  )
    throw new Error('offline_study_history');
  const entryById = new Map(entries.map((entry) => [entry.operationId, entry]));
  const heads = new Map<string, string>();
  const stoppedSessions = new Set<string>();
  for (const entry of entries) {
    if ((heads.get(entry.sessionId) ?? null) !== entry.predecessor)
      throw new Error('offline_study_history');
    heads.set(entry.sessionId, entry.operationId);
    const cardId = entry.before.id;
    const alias =
      entry.event.type === 'undo' &&
      entry.acknowledgement &&
      'cancellationId' in entry.acknowledgement
        ? entry.acknowledgement.cancellationId
        : undefined;
    const existing = history.get(alias ?? entry.operationId);
    if (existing) {
      if (
        existing.cardId !== cardId ||
        (entry.event.type === 'answer'
          ? existing.event.cancelsReviewId ||
            existing.event.resetsLearning ||
            existing.rating !== entry.event.payload.rating ||
            existing.durationMs !== entry.event.payload.durationMs ||
            (existing.submittedAt !== null &&
              existing.submittedAt !== entry.event.payload.reviewedAt)
          : existing.event.cancelsReviewId !== entry.event.payload.reviewId)
      )
        throw new Error('offline_study_history');
      continue;
    }
    if (
      entry.state !== 'pending' ||
      stoppedSessions.has(entry.sessionId) ||
      !cards.has(cardId) ||
      blocked.has(cardId) ||
      (entry.predecessor && entryById.get(entry.predecessor)?.state === 'rejected')
    ) {
      limit = entry.state === 'synchronized' ? 'history' : 'recovery';
      stoppedSessions.add(entry.sessionId);
      restrictCard(cardId);
      continue;
    }
    const card = cards.get(cardId)!;
    let event: ReviewEvent;
    if (entry.event.type === 'answer') {
      const time = instant(entry.event.payload.reviewedAt);
      if (time > now) {
        limit = 'recovery';
        stoppedSessions.add(entry.sessionId);
        restrictCard(cardId);
        continue;
      }
      const priorState = schedulingOf(card);
      const outcome = review(
        priorState,
        (ratings.indexOf(entry.event.payload.rating) + 1) as ReviewLog['rating'],
        time,
        scheduler,
        createSeededRandom(seedFromReviewId(entry.operationId)),
        entry.event.payload.durationMs,
      );
      event = {
        id: entry.operationId,
        order: snapshot.cursor + entry.sequence,
        priorState,
        log: outcome.log,
      };
      history.set(entry.operationId, {
        cardId,
        event,
        submittedAt: entry.event.payload.reviewedAt,
        rating: entry.event.payload.rating,
        durationMs: entry.event.payload.durationMs,
      });
    } else {
      const target = history.get(entry.event.payload.reviewId);
      if (
        !target ||
        target.cardId !== cardId ||
        target.event.cancelsReviewId ||
        target.event.resetsLearning
      ) {
        limit = 'recovery';
        stoppedSessions.add(entry.sessionId);
        restrictCard(cardId);
        continue;
      }
      event = {
        ...target.event,
        id: entry.operationId,
        order: snapshot.cursor + entry.sequence,
        cancelsReviewId: target.event.id,
      };
      history.set(entry.operationId, { ...target, event });
    }
    const events = byCard.get(cardId) ?? [];
    events.push(event);
    byCard.set(cardId, events);
    const life = lifeEvents(cardId);
    cards.set(
      cardId,
      withScheduling(card, projectReviewEvents(life, origin(card, life), scheduler)),
    );
  }
  for (const value of snapshot.edits) {
    const edit = value as { kind?: string; entityId?: string; state?: string };
    if (edit.kind === 'note-edit' && !['synchronized', 'resolved'].includes(edit.state ?? '')) {
      limit = 'content';
      if (edit.entityId) blockedNotes.add(edit.entityId);
    }
  }
  const cancelled = new Set(
    [...history.values()].flatMap(({ event }) =>
      event.cancelsReviewId ? [event.cancelsReviewId] : [],
    ),
  );
  const logs: WorkloadReview[] = [...history.values()]
    .filter(
      ({ event }) => !event.cancelsReviewId && !event.resetsLearning && !cancelled.has(event.id),
    )
    .sort(
      (a, b) =>
        a.event.log.reviewedAt.getTime() - b.event.log.reviewedAt.getTime() ||
        a.event.id.localeCompare(b.event.id),
    )
    .map(({ cardId, event }) => {
      const card = cards.get(cardId)!;
      return {
        ...event.log,
        cardId,
        noteId: card.noteId,
        deckId: card.deckId,
        direction: card.direction,
      };
    });
  const body = dailyStudySessionRequestSchema.parse(request);
  const chain: (typeof decks)[number][] = [];
  if (body.deckId !== undefined) {
    let deck = decks.find((deck) => deck.id === body.deckId);
    if (!deck) throw new Error('offline_study_incomplete');
    const seen = new Set<string>();
    while (deck) {
      if (seen.has(deck.id)) throw new Error('offline_study_incomplete');
      seen.add(deck.id);
      chain.unshift(deck);
      deck = decks.find((row) => row.id === deck!.parentId);
    }
  }
  const inside = (id: string, ancestor: string): boolean => {
    const deck = decks.find((row) => row.id === id);
    return id === ancestor || (!!deck?.parentId && inside(deck.parentId, ancestor));
  };
  const scope =
    body.deckId === undefined
      ? body.deckIds
      : liveDecks.filter((deck) => inside(deck.id, body.deckId!)).map((deck) => deck.id);
  if (scope?.some((id) => !liveIds.has(id))) throw new Error('offline_study_incomplete');
  const scopeDeckIds = [
    ...new Set(
      scope ??
        liveDecks
          .filter((deck) => deck.settings?.dailyStudyIncluded !== false)
          .map((deck) => deck.id),
    ),
  ].sort();
  const selected = new Set(scopeDeckIds);
  const pool = [...cards.values()]
    .filter(
      (card) =>
        liveCards.has(card.id) &&
        selected.has(card.deckId) &&
        !blocked.has(card.id) &&
        !blockedNotes.has(card.noteId),
    )
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id));
  const result = planDailyStudy({
    account,
    collections: decks,
    scopeDeckIds,
    explicitScope: scope !== undefined,
    settings: resolveDeckSettings([account.settings, ...chain.map((deck) => deck.settings)]),
    cards: pool.map((card) => ({
      id: card.id,
      noteId: card.noteId,
      deckId: card.deckId,
      direction: card.direction,
      scheduling: schedulingOf(card),
    })),
    allLogs: logs,
    body: limit ? { ...body, newCards: 'exclude' } : body,
    now,
  });
  return {
    ...result,
    planningContext: { accountId, revision: snapshot.cursor },
    cards: result.cards.map((card) => cards.get(card.id)!),
    notes: [...new Set(result.cards.map((card) => card.noteId))].map((id) => notes.get(id)!),
    offlineStudy: { limit, cursor: snapshot.cursor, sequence: snapshot.reviewSequence },
  };
}
