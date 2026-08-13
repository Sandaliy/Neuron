import { Navigate } from '@tanstack/react-router';

import { useTranslate } from '../i18n/provider';
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
 */
export function SessionGate({ children }: { readonly children: ReactNode }) {
  const t = useTranslate();
  const account = useAccount();

  if (account.isPending) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-16 py-32">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (account.error) {
    const failure = account.error;

    if (failure instanceof ApiFailure && failure.code === 'not_authenticated') {
      return <Navigate to="/sign-in" replace />;
    }

    if (failure instanceof ApiFailure && failure.code === 'password_change_required') {
      return <Navigate to="/recovery/password" replace />;
    }

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

  return <>{children}</>;
}
