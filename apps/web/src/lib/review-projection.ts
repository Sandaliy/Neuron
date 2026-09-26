import { availableForStudy, createSchedulerConfig, studyAvailableAt } from '@neuron/core';
import type { Card, DeckNode, Me } from '@neuron/shared';

import type { StudyPlanProjection } from './note-projection';
import type { QueryClient } from '@tanstack/react-query';

/** Apply only confirmed schedule changes. The server still owns fresh admission. */
export function projectConfirmedReview(client: QueryClient, before: Card, after: Card, now: Date) {
  const account = client.getQueryData<Me>(['account']);
  const config = createSchedulerConfig({
    timezone: account?.timezone ?? 'UTC',
    dayCutoffHour: account?.dayCutoffHour ?? 4,
  });
  const available = (card: Card) =>
    availableForStudy(
      {
        state: card.state,
        due: new Date(card.due),
        ...(card.lastReview ? { lastReview: new Date(card.lastReview) } : {}),
      },
      now,
      config,
    );
  const nextAt = studyAvailableAt(
    {
      state: after.state,
      due: new Date(after.due),
      ...(after.lastReview ? { lastReview: new Date(after.lastReview) } : {}),
    },
    config,
  );
  const beforeReady = available(before);
  const afterReady = available(after);
  const beforeDue = before.state !== 'new' && beforeReady;
  const afterDue = after.state !== 'new' && afterReady;
  const beforeFresh = before.state === 'new' && beforeReady;
  const afterFresh = after.state === 'new' && afterReady;

  for (const [key] of client.getQueriesData<StudyPlanProjection>({ queryKey: ['study-plan'] }))
    client.setQueryData<StudyPlanProjection>(key, (cached) => {
      if (!cached) return cached;
      const hadCard = cached.cards.some((card) => card.id === before.id);
      const cards = cached.cards.flatMap((card) =>
        card.id === before.id ? (afterReady ? [after] : []) : [card],
      );
      const delta = Number(afterReady) - Number(beforeReady);
      const deckSummaries = cached.deckSummaries.map((summary) =>
        hadCard && summary.deckId === before.deckId
          ? {
              ...summary,
              due: Math.max(0, summary.due + Number(afterDue) - Number(beforeDue)),
              fresh: Math.max(0, summary.fresh + Number(afterFresh) - Number(beforeFresh)),
              nextDue:
                !afterReady && nextAt > now
                  ? ([summary.nextDue, nextAt.toISOString()].filter(Boolean).sort()[0] ?? null)
                  : summary.nextDue,
            }
          : summary,
      );
      return {
        ...cached,
        localProjection: true,
        reviewProjection: true,
        cards,
        deckSummaries,
        availableCount: Math.max(0, cached.availableCount + (hadCard ? delta : 0)),
        newCount: cards.filter((card) => card.state === 'new').length,
        reviewCount: cards.filter((card) => card.state !== 'new').length,
        nextDue:
          hadCard && !afterReady && nextAt > now
            ? ([cached.nextDue, nextAt.toISOString()].filter(Boolean).sort()[0] ?? null)
            : cached.nextDue,
      };
    });

  // The Deck tree uses exact due instants. Patch its known change without
  // confusing that aggregate with Daily Study's study-day availability.
  const exactDue = (card: Card) => card.state !== 'new' && new Date(card.due) <= now;
  const dueDelta = Number(exactDue(after)) - Number(exactDue(before));
  const freshDelta = Number(after.state === 'new') - Number(before.state === 'new');
  client.setQueryData<{ decks: DeckNode[] }>(['decks'], (cached) => {
    if (!cached) return cached;
    const patch = (deck: DeckNode): DeckNode => {
      const children = deck.children.map(patch);
      const contains =
        deck.id === before.deckId || children.some((child, at) => child !== deck.children[at]);
      return contains
        ? {
            ...deck,
            children,
            due: Math.max(0, deck.due + dueDelta),
            fresh: Math.max(0, deck.fresh + freshDelta),
          }
        : deck;
    };
    return { decks: cached.decks.map(patch) };
  });
}
