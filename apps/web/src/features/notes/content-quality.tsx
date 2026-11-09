import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CONTENT_CHECKS, CONTENT_CHECK_KIND } from '@neuron/shared';
import type { ContentCheck } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { describe } from '../../lib/api';
import { useBrowseState } from '../../lib/browse-state';
import { useContentQuality } from '../../lib/content-quality';
import { flatten, useDeckTree } from '../../lib/decks';
import { accountEpoch, useOffline } from '../../lib/offline';
import { Button } from '../../ui/button';
import { RowGroup } from '../../ui/card';
import { Input } from '../../ui/input';
import { BackLink, PageHeader } from '../../ui/page-header';
import { Row, RowChevron } from '../../ui/row';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/states';
import { CheckBack } from '../library/library-checks';
import { ScopeSelect } from '../library/scope-select';

import { QualityRows } from './quality-rows';

import type { QualityReturn } from './quality-rows';

interface Browse {
  typed: string;
  deckId: string | undefined;
  category: ContentCheck | undefined;
  returning: QualityReturn | undefined;
}
const initial: Browse = { typed: '', deckId: undefined, category: undefined, returning: undefined };

export function ContentQualityScreen() {
  const offline = useOffline();
  return <QualityBrowser key={`${offline.accountId}:${accountEpoch()}`} />;
}

function QualityBrowser() {
  const t = useTranslate();
  const navigate = useNavigate();
  const offline = useOffline();
  const visit = accountEpoch();
  const browseKey = useMemo(
    () => ['content-quality-browse', offline.accountId, visit],
    [offline.accountId, visit],
  );
  const [browse, update] = useBrowseState(browseKey, initial);
  const [search, setSearch] = useState(browse.typed.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSearch(browse.typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [browse.typed]);
  const query = useContentQuality(browse.deckId, search, browse.category);
  const tree = useDeckTree();
  const decks = useMemo(() => {
    const all = flatten(tree.data ?? []);
    const names = new Map(all.map((deck) => [deck.id, deck.name]));
    return all
      .filter((deck) => deck.kind === 'deck' && deck.rev > 0)
      .map((deck) => ({
        id: deck.id,
        label: [...deck.path.map((id) => names.get(id)), deck.name].filter(Boolean).join(' / '),
      }));
  }, [tree.data]);
  const unavailable = offline.offline && !offline.available;
  const rows = useMemo(() => {
    if (unavailable) return [];
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((page) => page.items) ?? []).filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [unavailable, query.data]);
  const summary = unavailable ? undefined : query.data?.pages[0];
  const local = offline.offline || query.data?.pages.some((page) => page.local);
  const busy = query.isFetching || search !== browse.typed.trim();
  const category = browse.category;
  return (
    <section data-screen="" className="flex min-w-0 flex-col gap-16">
      <PageHeader
        title={t('quality.title')}
        back={
          category ? (
            <BackLink
              label={t('quality.allChecks')}
              onClick={() => {
                update({ category: undefined, returning: undefined });
                window.scrollTo({ top: 0, behavior: 'instant' });
              }}
            />
          ) : (
            <CheckBack />
          )
        }
      />
      <ScopeSelect
        label={t('quality.scope')}
        value={browse.deckId ?? ''}
        onChange={(event) =>
          update({ deckId: event.target.value || undefined, returning: undefined })
        }
      >
        <option value="">{t('quality.library')}</option>
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.label}
          </option>
        ))}
      </ScopeSelect>
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute top-16 left-12 z-10 text-secondary"
        />
        <Input
          type="search"
          className="pl-40"
          aria-label={t('quality.search')}
          placeholder={t('quality.search')}
          value={browse.typed}
          maxLength={100}
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          busy={busy}
          onChange={(event) => update({ typed: event.target.value, returning: undefined })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              setSearch(browse.typed.trim());
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {(unavailable || local) && (
        <p role="status" className="text-13 text-secondary">
          {t(unavailable ? 'offline.incomplete' : 'offline.results')}
        </p>
      )}
      {!unavailable && (
        <>
          {category && (
            <div className="flex flex-col gap-4">
              <p className="text-13 text-secondary">
                {t(`quality.${CONTENT_CHECK_KIND[category]}`)}
              </p>
              <h2 className="font-display text-20 text-primary">
                {t(`quality.check.${category}`)}
              </h2>
              <p className="text-14 text-secondary">{t(`quality.meaning.${category}`)}</p>
            </div>
          )}
          {query.error && (
            <ErrorState
              message={t(describe(query.error).key, describe(query.error).values)}
              retryLabel={t('common.retry')}
              onRetry={() => void query.refetch()}
            />
          )}
          {query.isPending ? (
            <SkeletonRows rows={4} />
          ) : (
            summary && (
              <>
                <p role="status" aria-busy={busy} className="text-13 text-secondary">
                  {category
                    ? t('quality.results', { count: rows.length, total: summary.counts[category] })
                    : t('quality.coverage', { count: summary.vocabularyCount })}
                </p>
                {category ? (
                  rows.length ? (
                    <QualityRows
                      key={`${category}:${search}:${browse.deckId}:${local}`}
                      rows={rows}
                      returning={browse.returning}
                      onOpen={(row, returning) => {
                        update({ returning });
                        void navigate({
                          to: '/notes/$noteId',
                          params: { noteId: row.id },
                          state: { qualityOrigin: { accountId: offline.accountId, visit } },
                        });
                      }}
                    />
                  ) : (
                    <EmptyState
                      title={t('quality.empty')}
                      description={t(
                        search || browse.deckId ? 'quality.filteredEmpty' : 'quality.completed',
                      )}
                    />
                  )
                ) : (
                  <>
                    {(['consistency', 'enrichment'] as const).map((kind) => (
                      <div key={kind} className="flex flex-col gap-8">
                        <h2 className="font-mono text-12 tracking-wide text-tertiary uppercase">
                          {t(`quality.${kind}`)}
                        </h2>
                        <RowGroup>
                          {CONTENT_CHECKS.filter((check) => CONTENT_CHECK_KIND[check] === kind).map(
                            (check) => (
                              <Row
                                key={check}
                                standalone={false}
                                title={t(`quality.check.${check}`)}
                                trailing={
                                  <span className="flex shrink-0 items-center gap-8">
                                    <span
                                      data-numeric=""
                                      className={`text-14 ${summary.counts[check] === 0 ? 'text-tertiary' : 'text-primary'}`}
                                    >
                                      {summary.counts[check]}
                                    </span>
                                    <RowChevron />
                                  </span>
                                }
                                onClick={() => {
                                  update({ category: check, returning: undefined });
                                  window.scrollTo({ top: 0, behavior: 'instant' });
                                }}
                              />
                            ),
                          )}
                        </RowGroup>
                      </div>
                    ))}
                    {!summary.vocabularyCount && (
                      <EmptyState
                        title={t('quality.noVocabulary')}
                        description={t('quality.noVocabularyHint')}
                      />
                    )}
                  </>
                )}
                {query.hasNextPage && (
                  <Button
                    variant="quiet"
                    disabled={query.isFetching}
                    onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
                  >
                    {t('quality.more')}
                  </Button>
                )}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
