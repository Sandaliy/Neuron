import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  PRACTICE_FIELDS,
  hasPracticeSide,
  practiceFields,
  practiceFieldLabel,
  practiceValue,
  samePracticeSides,
} from '@neuron/shared';
import type { Note, PracticeRun, PracticeSide, PracticeField } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe, request } from '../../lib/api';
import { findDeck, useDeckTree } from '../../lib/decks';
import { practiceStore } from '../../lib/practice';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { CompletionProgress } from '../../ui/completion-progress';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { LearningCard } from '../../ui/learning-card';
import { ModeHeader } from '../../ui/mode-header';
import { ErrorState, SkeletonRows } from '../../ui/states';

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
  const [revealed, setRevealed] = useState(false);
  const run = state.run;
  const current = notes.find((note) => note.id === run?.queue[0]);
  const statuses = Object.values(run?.statuses ?? {});
  const known = statuses.filter((status) => status === 'known').length;
  const learning = statuses.filter((status) => status === 'learning').length;
  const eligible = notes.filter(
    (note) => hasPracticeSide(note.fields, front) && hasPracticeSide(note.fields, back),
  );
  return (
    <section
      data-screen=""
      className="flex min-h-[calc(100dvh-var(--bar-height)-var(--safe-top)-var(--safe-bottom)-52px)] flex-col gap-16"
    >
      <ModeHeader
        title={t('practice.title')}
        exitLabel={t('practice.exit')}
        onExit={onFinish}
        value={known}
        max={statuses.length}
        action={
          <span role="status" className="text-12 text-secondary">
            {t(state.saving ? 'practice.saving' : 'practice.saved')}
          </span>
        }
      />
      {state.error ? (
        <ErrorState
          message={t(describe(state.error).key)}
          retryLabel={t('common.retry')}
          onRetry={store.retry}
        />
      ) : null}
      {state.loading ? (
        <SkeletonRows rows={3} />
      ) : !run || configuring ? (
        <>
          {run && <p className="text-14 text-secondary">{t('practice.changeWarning')}</p>}
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
            disabled={samePracticeSides(front, back) || !eligible.length || !!state.error}
            onClick={() => {
              store.act({ kind: 'start', front, back });
              setConfiguring(false);
              setRevealed(false);
            }}
          >
            {t(run ? 'practice.restart' : 'practice.start')}
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
                prompt={<PracticeFace fields={current.fields} side={run.front} />}
                answer={
                  revealed ? <PracticeFace fields={current.fields} side={run.back} /> : undefined
                }
              />
              {revealed ? (
                <div className="neu-reveal grid grid-cols-2 gap-8">
                  {[false, true].map((value) => (
                    <Button
                      key={String(value)}
                      variant={value ? 'primary' : 'quiet'}
                      disabled={!!state.error}
                      onClick={() => {
                        store.act({ kind: 'answer', noteId: current.id, known: value });
                        setRevealed(false);
                      }}
                    >
                      {t(value ? 'practice.know' : 'practice.learning')}
                    </Button>
                  ))}
                </div>
              ) : (
                <Button variant="primary" onClick={() => setRevealed(true)}>
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
                  {t('practice.completionCounts', { known, learning: statuses.length - known })}
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
                  onClick={() => store.act({ kind: 'start', front: run.front, back: run.back })}
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
          {current && (
            <Button
              className="self-start"
              variant="text"
              onClick={() => {
                setFront(run.front);
                setBack(run.back);
                setConfiguring(true);
              }}
            >
              {t('practice.changeFields')}
            </Button>
          )}
        </>
      )}
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
}: {
  readonly fields: Record<string, unknown>;
  readonly side: PracticeSide;
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
            </p>
          </div>
        );
      })}
    </div>
  );
}
