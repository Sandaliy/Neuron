import { Link } from '@tanstack/react-router';

import { useTranslate } from '../i18n/locale';
import { describe } from '../lib/api';
import { ErrorState } from '../ui/states';

/**
 * The last thing between a bug and a white screen.
 *
 * Without this, a component that throws leaves an empty page, or the router's
 * own message, which is an English sentence with a stack trace under it. The
 * person using this is not a developer and does not read English error text.
 *
 * The details are still written to the console for whoever is debugging. What
 * reaches the screen is a sentence and a way out.
 */
export function Failure({ error, reset }: { readonly error: Error; readonly reset?: () => void }) {
  const t = useTranslate();
  const { key, values } = describe(error);

  console.error(error);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center px-16">
      <ErrorState
        message={t(key, values)}
        retryLabel={t('common.retry')}
        onRetry={reset ?? (() => window.location.reload())}
      />
    </div>
  );
}

/** An address that is not a screen. */
export function NotFound() {
  const t = useTranslate();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col items-center justify-center gap-24 px-16">
      <p className="text-center text-16 text-text">{t('error.not_found')}</p>
      <Link to="/" className="min-h-44 text-16 text-accent underline underline-offset-4">
        {t('today.title')}
      </Link>
    </div>
  );
}
