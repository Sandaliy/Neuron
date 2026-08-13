import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

import type { Locale } from '@neuron/shared';

import { setLocale } from '../i18n/locale';
import { ToastProvider } from '../ui/toast';

import type { ReactElement, ReactNode } from 'react';

/**
 * A component under the providers it expects.
 *
 * The locale is pinned rather than read from the browser, so a test asserting
 * on a sentence asserts on the same sentence wherever it runs.
 */
export function renderWithProviders(ui: ReactElement, { locale = 'en' as Locale } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  // The language is a device preference rather than a provider, so it is
  // pinned by setting it, the same way the application does.
  setLocale(locale);

  function Providers({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Providers });
}
