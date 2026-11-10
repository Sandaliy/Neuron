import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';

import type { DeckNode, MessageKey } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { findDeck, useDeckTree } from '../../lib/decks';
import { accountEpoch, useOffline } from '../../lib/offline';
import { RowGroup } from '../../ui/card';
import { BackLink, PageHeader } from '../../ui/page-header';
import { Row, RowChevron } from '../../ui/row';

const CHECKS = [
  { to: '/library/duplicates', title: 'duplicates.title', subtitle: 'checks.duplicates' },
  { to: '/library/quality', title: 'quality.title', subtitle: 'checks.quality' },
  { to: '/library/slipping', title: 'problems.title', subtitle: 'checks.slipping' },
] as const satisfies readonly { to: string; title: MessageKey; subtitle: MessageKey }[];

/**
 * The three checks, each with one line on what it looks for.
 *
 * None of them changes anything by itself. Each lists Notes or Cards worth a
 * look and opens them in the editor, so they live one step away from the
 * Library rather than on it.
 */
export function LibraryChecksScreen() {
  const t = useTranslate();
  const navigate = useNavigate();
  const offline = useOffline();
  return (
    <section data-screen="" className="flex flex-col gap-16">
      <PageHeader
        title={t('checks.title')}
        back={
          <BackLink label={t('library.title')} onClick={() => void navigate({ to: '/library' })} />
        }
      />
      <RowGroup>
        {CHECKS.map((check) => (
          <Row
            key={check.to}
            standalone={false}
            title={t(check.title)}
            subtitle={t(check.subtitle)}
            trailing={<RowChevron />}
            onClick={() =>
              void navigate({
                to: check.to,
                state: { checksOrigin: { accountId: offline.accountId, visit: accountEpoch() } },
              })
            }
          />
        ))}
      </RowGroup>
    </section>
  );
}

/**
 * Back for a check screen: to the Checks list it was opened from, to the Deck
 * whose menu opened it, or to Checks when it was opened by its address.
 */
export function CheckBack({ deckId }: { readonly deckId?: string | undefined }) {
  const t = useTranslate();
  const router = useRouter();
  const navigate = useNavigate();
  const offline = useOffline();
  const tree = useDeckTree();
  const origin = useRouterState({ select: (state) => state.location.state.checksOrigin });
  const fromChecks = origin?.accountId === offline.accountId && origin.visit === accountEpoch();
  const deck: DeckNode | undefined =
    !fromChecks && deckId ? findDeck(tree.data ?? [], deckId) : undefined;
  if (deck)
    return (
      <BackLink
        label={deck.name}
        onClick={() => void navigate({ to: '/notes', search: { deckId: deck.id } })}
      />
    );
  return (
    <BackLink
      label={t('checks.title')}
      onClick={() =>
        fromChecks ? router.history.back() : void navigate({ to: '/library/checks' })
      }
    />
  );
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    checksOrigin?: { accountId: string | null; visit: number };
  }
}
