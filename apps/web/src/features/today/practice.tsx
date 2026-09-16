import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { MessageKey, Note } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe, request } from '../../lib/api';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { Select } from '../../ui/select';
import { ErrorState, SkeletonRows } from '../../ui/states';

export function DeckPractice({
  deckId,
  onFinish,
}: {
  readonly deckId: string;
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const pool = useQuery({
    queryKey: ['practice', deckId],
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
  if (pool.data) return <Practice notes={pool.data} onFinish={onFinish} />;
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

/** Presentation-only state. This component has no mutation or scheduler dependency. */
export function Practice({
  notes,
  onFinish,
}: {
  readonly notes: readonly Note[];
  readonly onFinish: () => void;
}) {
  const t = useTranslate();
  const fields = [
    'term',
    'translation',
    'definition',
    'example',
    'front',
    'back',
    'text',
    'extra',
  ].filter((key) => notes.some((note) => typeof note.fields[key] === 'string' && note.fields[key]));
  const [front, setFront] = useState(fields[0] ?? 'front');
  const [back, setBack] = useState(fields[1] ?? 'back');
  const [pool, setPool] = useState<readonly Note[]>();
  const [index, setIndex] = useState(0);
  const [learning, setLearning] = useState<Note[]>([]);
  const [revealed, setRevealed] = useState(false);
  const current = pool?.[index];
  const eligible = notes.filter(
    (note) =>
      typeof note.fields[front] === 'string' &&
      note.fields[front] &&
      typeof note.fields[back] === 'string' &&
      note.fields[back],
  );
  function answer(known: boolean) {
    if (!current || !revealed) return;
    if (!known) setLearning((items) => [...items, current]);
    setIndex((value) => value + 1);
    setRevealed(false);
  }
  return (
    <section data-screen="" className="flex min-h-[65dvh] flex-col gap-20">
      <h1 className="font-display text-24 text-primary">{t('practice.title')}</h1>
      <p className="text-13 text-secondary">{t('practice.scheduleSafe')}</p>
      {!pool ? (
        <>
          <label className="text-14 text-secondary">
            {t('practice.front')}
            <Select value={front} onChange={(event) => setFront(event.target.value)}>
              {fields.map((key) => (
                <option key={key} value={key}>
                  {t(`note.field.${key}` as MessageKey)}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-14 text-secondary">
            {t('practice.back')}
            <Select value={back} onChange={(event) => setBack(event.target.value)}>
              {fields.map((key) => (
                <option key={key} value={key}>
                  {t(`note.field.${key}` as MessageKey)}
                </option>
              ))}
            </Select>
          </label>
          <p className="text-13 text-secondary">
            {t('practice.pool', { count: eligible.length, total: notes.length })}
          </p>
          <Button
            variant="primary"
            disabled={front === back || !eligible.length}
            onClick={() => setPool(eligible)}
          >
            {t('practice.start')}
          </Button>
        </>
      ) : current ? (
        <>
          <p className="text-13 text-secondary" role="status">
            {t('practice.progress', { count: index, total: pool.length })}
          </p>
          <Card className="flex flex-1 flex-col justify-center gap-24 break-words">
            <p className="font-display text-32 text-primary">{String(current.fields[front])}</p>
            {revealed && (
              <p className="neu-reveal border-t border-subtle pt-20 text-24 text-primary">
                {String(current.fields[back])}
              </p>
            )}
          </Card>
          {revealed ? (
            <div className="grid grid-cols-2 gap-8">
              <Button onClick={() => answer(false)}>{t('practice.learning')}</Button>
              <Button variant="primary" onClick={() => answer(true)}>
                {t('practice.know')}
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setRevealed(true)}>
              {t('study.reveal')}
            </Button>
          )}
        </>
      ) : (
        <Card className="flex flex-col gap-16">
          <h2 className="text-24 text-primary">
            {t(learning.length ? 'practice.roundComplete' : 'practice.cleared')}
          </h2>
          <p className="text-14 text-secondary">
            {t('practice.remaining', { count: learning.length })}
          </p>
          {learning.length > 0 && (
            <Button
              variant="primary"
              onClick={() => {
                setPool(learning);
                setLearning([]);
                setIndex(0);
              }}
            >
              {t('practice.repeat')}
            </Button>
          )}
        </Card>
      )}
      <Button onClick={onFinish}>{t('study.finish')}</Button>
    </section>
  );
}
