import { Navigate } from '@tanstack/react-router';

import { useTranslate } from '../i18n/locale';
import { useAccount } from '../lib/account';
import { ApiFailure, describe } from '../lib/api';
import { ErrorState, SkeletonRows } from '../ui/states';

import type { ReactNode } from 'react';

/**
 * The door to everything behind a sign in.
 *
 * It asks the api rather than reading the cookie, because the cookie says only
 * that a session existed at some point. The api says whether it still works,
 * and there are three answers worth telling apart:
 *
 *   no session         go and sign in
 *   a recovery session go and choose a password, the only thing it may do
 *   no server          say so, and offer to try again
 *
 * The third is not a signed out person, and sending them to a sign in form
 * they cannot complete is the wrong answer to a network that dropped.
 *
 * The order matters once the answer is already known. A session that has been
 * taken away has to be acted on whenever it is discovered, but a request that
 * failed to arrive must not take the screens away from somebody who is already
 * using them: losing the connection for a moment would otherwise replace the
 * whole app with an error page and then put it back.
 */
export function SessionGate({ children }: { readonly children: ReactNode }) {
  const t = useTranslate();
  const account = useAccount();
  const failure = account.error;

  if (failure instanceof ApiFailure && failure.code === 'not_authenticated') {
    return <Navigate to="/sign-in" replace />;
  }

  if (failure instanceof ApiFailure && failure.code === 'password_change_required') {
    return <Navigate to="/recovery/password" replace />;
  }

  // Already through the door. A later request that failed is not a reason to
  // close it: the session is still good as far as anybody knows, and the
  // screens keep whatever they last had.
  if (account.data) {
    return <>{children}</>;
  }

  if (failure) {
    const { key, values } = describe(failure);

    return (
      <div className="mx-auto w-full max-w-[720px] px-16 py-32">
        <ErrorState
          message={t(key, values)}
          retryLabel={t('common.retry')}
          onRetry={() => void account.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-16 py-32">
      <SkeletonRows rows={4} />
    </div>
  );
}
