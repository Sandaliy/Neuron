import { useNavigate } from '@tanstack/react-router';
import { Clock, ListChecks, Search, Tags, Trash2 } from 'lucide-react';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';
import { ServerControls } from '../../ui/server-controls';

/**
 * The ways into the Library other than its Folders.
 *
 * There were seven buttons of equal weight above the hierarchy, two searches,
 * two browsing views and three checks, and Deleted as an unlabelled icon among
 * the creation buttons. Search is one entry now, drawn like the field it opens,
 * because it is the one people reach for. The rest are four labelled buttons in
 * a two by two grid, which fits a 375 pixel phone in either language without a
 * lone button stretched across a row of its own. The three checks sit behind
 * Checks, a screen that says what each one looks for.
 */
export function LibraryTools({ deletedAvailable }: { readonly deletedAvailable: boolean }) {
  const t = useTranslate();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-12">
      <button
        type="button"
        data-library-search=""
        onClick={() => void navigate({ to: '/notes' })}
        className="flex min-h-48 w-full items-center gap-12 rounded-12 border border-default bg-input px-12 text-left text-16 text-tertiary hover:border-strong"
      >
        <Search
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className="shrink-0 text-secondary"
        />
        <span className="truncate">{t('search.library')}</span>
      </button>
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 [&_button]:w-full [&_button]:justify-start [&_button]:px-12">
        <Button
          variant="quiet"
          onClick={() => void navigate({ to: '/notes', search: { recent: 'added' } })}
        >
          <Clock size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
          {t('library.tools.recent')}
        </Button>
        <Button variant="quiet" onClick={() => void navigate({ to: '/library/categories' })}>
          <Tags size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
          {t('categories.title')}
        </Button>
        <Button variant="quiet" onClick={() => void navigate({ to: '/library/checks' })}>
          <ListChecks size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
          {t('checks.title')}
        </Button>
        <ServerControls available={deletedAvailable}>
          <Button variant="quiet" onClick={() => void navigate({ to: '/library/deleted' })}>
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            {t('deleted.title')}
          </Button>
        </ServerControls>
      </div>
    </div>
  );
}
