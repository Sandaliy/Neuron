import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { ReactNode } from 'react';

/**
 * Short confirmations, and failures that are not attached to a field.
 *
 * One line, no action, and it leaves by itself. Not for anything a person has
 * to act on: a toast carrying the only copy of something important is a toast
 * somebody misses while looking at their keyboard.
 *
 * It is a floating layer, so it is glass, and it sits above the tab bar and
 * above the home indicator.
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
            data-g="toast"
            onOpenChange={(open) => {
              if (!open) {
                setMessages((current) => current.filter((item) => item.id !== message.id));
              }
            }}
            className={[
              'pointer-events-auto rounded-18 px-16 py-12 text-14',
              'data-[state=open]:neu-toast-in data-[state=closed]:neu-toast-out',
              message.tone === 'danger' ? 'text-error' : 'text-primary',
            ].join(' ')}
          >
            <RadixToast.Description>{message.text}</RadixToast.Description>
          </RadixToast.Root>
        ))}

        {/* One safe-area-aware offset above native fixed navigation. */}
        <RadixToast.Viewport
          data-toasts=""
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col gap-8 p-16 pb-[calc(var(--safe-bottom)+var(--bar-height)+var(--bar-inset)+20px)]"
        />
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
