import { availableForStudy, createSchedulerConfig } from '@neuron/core';
import type { Card, DailyStudySession, DeckNode, Me, Note } from '@neuron/shared';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';

type Detail = { note: Note; cards: Card[] };
export type StudyPlanProjection = DailyStudySession & { localProjection?: boolean };
type Pages = InfiniteData<{ items: Note[]; nextCursor?: string }>;
type Change = { before: Note; after: Note; cards?: Card[]; oldCards?: Card[] };

function matches(client: QueryClient, note: Note, params: URLSearchParams): boolean {
  if (params.get('status') && params.get('status') !== note.status) return false;
  if (params.get('tag') && !note.tags.includes(params.get('tag')!)) return false;
  const state = params.get('cardState');
  if (state && note.cardStates && !note.cardStates[state as keyof typeof note.cardStates])
    return false;
  const deckId = params.get('deckId');
  if (!deckId || deckId === note.deckId) return true;
  if (params.get('subtree') === 'false') return false;
  const parents = new Map<string, string | null>();
  const visit = (rows: readonly DeckNode[]) => {
    for (const row of rows) {
      parents.set(row.id, row.parentId);
      visit(row.children);
    }
  };
  visit(client.getQueryData<{ decks: DeckNode[] }>(['decks'])?.decks ?? []);
  const seen = new Set<string>();
  let parent = parents.get(note.deckId);
  while (parent && !seen.has(parent)) {
    if (parent === deckId) return true;
    seen.add(parent);
    parent = parents.get(parent);
  }
  return false;
}

/** Entity-local inverse patches preserve unrelated writes, including other pages. */
export function projectNotes(
  client: QueryClient,
  ids: readonly string[],
  edit: (note: Note) => Note,
  editCards?: (cards: Card[]) => Card[],
) {
  void client.cancelQueries({ queryKey: ['notes'] });
  void client.cancelQueries({ queryKey: ['decks'] });
  void client.cancelQueries({ queryKey: ['study-plan'] });
  const known = new Map<string, Note>();
  const lists = client.getQueriesData<Pages>({ queryKey: ['notes', 'list'] });
  const plans = client.getQueriesData<DailyStudySession>({ queryKey: ['study-plan'] });
  for (const [, data] of client.getQueriesData<Pages>({ queryKey: ['notes', 'list'] }))
    for (const page of data?.pages ?? []) for (const note of page.items) known.set(note.id, note);
  for (const [, plan] of plans)
    for (const note of plan?.notes ?? []) if (!known.has(note.id)) known.set(note.id, note);
  const changes: Change[] = ids.flatMap((id) => {
    const detail = client.getQueryData<Detail>(['notes', id]);
    const before = detail?.note ?? known.get(id);
    if (!before) return [];
    return [
      {
        before,
        after: edit(before),
        ...(detail
          ? { oldCards: detail.cards, cards: editCards ? editCards(detail.cards) : detail.cards }
          : {}),
      },
    ];
  });
  apply(client, changes);
  return () => {
    apply(
      client,
      changes.map((change) => ({
        before: change.after,
        after: change.before,
        ...(change.cards && change.oldCards
          ? { oldCards: change.cards, cards: change.oldCards }
          : {}),
      })),
    );
    for (const [key, before] of lists)
      client.setQueryData<Pages>(
        key,
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page, index) => {
              const items = [...page.items];
              for (const [at, note] of (before?.pages[index]?.items ?? []).entries())
                if (ids.includes(note.id) && !items.some((item) => item.id === note.id)) {
                  const restored = client.getQueryData<Detail>(['notes', note.id])?.note ?? note;
                  const params = new URLSearchParams(String(key[2]));
                  if (matches(client, restored, params)) items.splice(at, 0, restored);
                }
              return { ...page, items };
            }),
          },
      );
    for (const [key, before] of plans)
      client.setQueryData<DailyStudySession>(key, (current) => {
        if (!current || !before) return current;
        const cards = [...current.cards];
        for (const [at, card] of before.cards.entries())
          if (
            ids.includes(card.noteId) &&
            !cards.some((item) => item.id === card.id) &&
            (client.getQueryData<Detail>(['notes', card.noteId])?.note.status ?? 'active') ===
              'active'
          )
            cards.splice(at, 0, card);
        return {
          ...current,
          cards,
          newCount: cards.filter((card) => card.state === 'new').length,
          reviewCount: cards.filter((card) => card.state !== 'new').length,
        };
      });
  };
}

function apply(client: QueryClient, changes: Change[]) {
  changes = changes.map((change) => {
    const current = client.getQueryData<Detail>(['notes', change.before.id]);
    if (!current) return change;
    const after = { ...current.note };
    for (const key of Object.keys(change.after) as (keyof Note)[])
      if (change.before[key] !== change.after[key] && current.note[key] === change.before[key])
        Object.assign(after, { [key]: change.after[key] });
    const cards = current.cards.map((card) => {
      const before = change.oldCards?.find((item) => item.id === card.id);
      const target = change.cards?.find((item) => item.id === card.id);
      if (!before || !target || before === target) return card;
      const next = { ...card };
      for (const key of Object.keys(target) as (keyof Card)[])
        if (before[key] !== target[key] && card[key] === before[key])
          Object.assign(next, { [key]: target[key] });
      return next;
    });
    const changedCards = cards.some((card, at) => card !== current.cards[at]);
    if (changedCards) {
      after.cardStates = { new: 0, learning: 0, review: 0, relearning: 0 };
      for (const card of cards) after.cardStates[card.state]++;
    }
    return {
      before: current.note,
      after,
      oldCards: current.cards,
      cards: changedCards ? cards : current.cards,
    };
  });
  const byId = new Map(changes.map((change) => [change.before.id, change]));
  const patch = (note: Note) => {
    const change = byId.get(note.id);
    if (!change) return note;
    const result = { ...note };
    for (const key of Object.keys(change.after) as (keyof Note)[]) {
      if (key === 'cardStates' && change.oldCards !== change.cards)
        Object.assign(result, { cardStates: change.after.cardStates });
      else if (change.before[key] !== change.after[key] && note[key] === change.before[key])
        Object.assign(result, { [key]: change.after[key] });
    }
    return result;
  };
  for (const [key, data] of client.getQueriesData<Pages>({ queryKey: ['notes', 'list'] })) {
    if (!data) continue;
    const params = new URLSearchParams(String(key[2]));
    client.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map(patch).filter((note) => {
          if (!byId.has(note.id)) return true;
          return matches(client, note, params);
        }),
      })),
    });
  }
  for (const change of changes)
    client.setQueryData<Detail>(
      ['notes', change.before.id],
      (data) =>
        data && {
          note: patch(data.note),
          cards: data.cards === change.oldCards && change.cards ? change.cards : data.cards,
        },
    );
  const account = client.getQueryData<Me>(['account']);
  const config = createSchedulerConfig({
    timezone: account?.timezone ?? 'UTC',
    dayCutoffHour: account?.dayCutoffHour ?? 4,
  });
  const now = new Date();
  const counts = (note: Note, cards: Card[] | undefined, exact: boolean, direction?: string) => {
    const live =
      note.status === 'active'
        ? ((cards ?? note.studyCards)?.filter(
            (card) => !card.suspendedAt && (!direction || card.direction === direction),
          ) ?? [])
        : [];
    return {
      fresh: live.filter((card) => card.state === 'new').length,
      due: live.filter(
        (card) =>
          card.state !== 'new' &&
          (exact
            ? new Date(card.due) <= now
            : availableForStudy({ state: card.state, due: new Date(card.due) }, now, config)),
      ).length,
    };
  };
  const delta = (deckId: string, exact: boolean, direction?: string) =>
    changes.reduce(
      (sum, change) => {
        const before = counts(change.before, change.oldCards, exact, direction);
        const after = counts(change.after, change.cards, exact, direction);
        return {
          due:
            sum.due +
            (change.after.deckId === deckId ? after.due : 0) -
            (change.before.deckId === deckId ? before.due : 0),
          fresh:
            sum.fresh +
            (change.after.deckId === deckId ? after.fresh : 0) -
            (change.before.deckId === deckId ? before.fresh : 0),
        };
      },
      { due: 0, fresh: 0 },
    );
  client.setQueryData<{ decks: DeckNode[] }>(['decks'], (data) => {
    if (!data) return data;
    const visit = (rows: readonly DeckNode[]): DeckNode[] =>
      rows.map((row) => {
        const children = visit(row.children);
        const own = delta(row.id, true);
        return {
          ...row,
          children,
          ...(row.noteCount === undefined
            ? {}
            : {
                noteCount: Math.max(
                  0,
                  row.noteCount +
                    changes.reduce(
                      (sum, change) =>
                        sum +
                        Number(change.after.deckId === row.id) -
                        Number(change.before.deckId === row.id),
                      0,
                    ) +
                    children.reduce(
                      (sum, child, at) =>
                        sum + (child.noteCount ?? 0) - (row.children[at]!.noteCount ?? 0),
                      0,
                    ),
                ),
              }),
          due: Math.max(
            0,
            row.due +
              own.due +
              children.reduce((sum, child, at) => sum + child.due - row.children[at]!.due, 0),
          ),
          fresh: Math.max(
            0,
            row.fresh +
              own.fresh +
              children.reduce((sum, child, at) => sum + child.fresh - row.children[at]!.fresh, 0),
          ),
        };
      });
    return { decks: visit(data.decks) };
  });
  for (const [key] of client.getQueriesData<StudyPlanProjection>({ queryKey: ['study-plan'] }))
    client.setQueryData<StudyPlanProjection>(key, (data) => {
      if (!data) return data;
      // A projection communicates participation immediately. A fresh server plan
      // is still required to admit new cards under workload and fairness policy.
      const notes = data.notes.map(patch);
      const affectsAdmission = changes.some(
        (change) =>
          change.before.status !== change.after.status ||
          change.before.deckId !== change.after.deckId ||
          change.oldCards !== change.cards,
      );
      if (!affectsAdmission) return { ...data, notes };
      const cards = data.cards.filter((card) => {
        const change = byId.get(card.noteId);
        return (
          !change ||
          (change.before.status === change.after.status &&
            change.before.deckId === change.after.deckId &&
            change.oldCards === change.cards)
        );
      });
      const deckSummaries = data.deckSummaries.map((summary) => {
        const change = delta(
          summary.deckId,
          false,
          typeof key[2] === 'string' ? key[2] : undefined,
        );
        return {
          ...summary,
          due: Math.max(0, summary.due + change.due),
          fresh: Math.max(0, summary.fresh + change.fresh),
        };
      });
      return {
        ...data,
        localProjection: true,
        notes,
        cards,
        deckSummaries,
        availableCount: deckSummaries.reduce((sum, deck) => sum + deck.due + deck.fresh, 0),
        newCount: cards.filter((card) => card.state === 'new').length,
        reviewCount: cards.filter((card) => card.state !== 'new').length,
      };
    });
}
