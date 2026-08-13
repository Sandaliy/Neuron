import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { ReactNode } from 'react';

/**
 * Short confirmations, and failures that are not attached to a field.
 *
 * Not for anything a person has to act on. A toast that carries the only copy
 * of something important is a toast somebody misses while looking at their
 * keyboard.
 */

type Tone = 'neutral' | 'danger';

interface ToastValue {
  readonly show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastValue | undefined>(undefined);

interface Message {
  readonly id: number;
  readonly text: string;
  readonly tone: Tone;
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [messages, setMessages] = useState<readonly Message[]>([]);

  const show = useCallback((text: string, tone: Tone = 'neutral') => {
    setMessages((current) => [...current, { id: Date.now() + current.length, text, tone }]);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="down" duration={5000}>
        {children}

        {messages.map((message) => (
          <RadixToast.Root
            key={message.id}
            onOpenChange={(open) => {
              if (!open) {
                setMessages((current) => current.filter((item) => item.id !== message.id));
              }
            }}
            className={[
              'rounded-10 border bg-surface px-16 py-12 text-16',
              message.tone === 'danger' ? 'border-danger text-danger' : 'border-border text-text',
            ].join(' ')}
          >
            <RadixToast.Description>{message.text}</RadixToast.Description>
          </RadixToast.Root>
        ))}

        {/*
          Above the bottom bar and above the home indicator. A message that
          lands underneath either one is a message nobody reads.
        */}
        <RadixToast.Viewport className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-8 p-16 pb-[calc(var(--safe-bottom)+var(--bar-height)+16px)]" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);

  if (!value) {
    throw new Error('useToast was called outside ToastProvider');
  }

  return value;
}
