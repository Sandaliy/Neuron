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
  readonly open: boolean;
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [messages, setMessages] = useState<readonly Message[]>([]);

  const show = useCallback((text: string, tone: Tone = 'neutral') => {
    setMessages((current) => [
      ...current,
      { id: Date.now() + current.length, text, tone, open: true },
    ]);
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
            open={message.open}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && !message.open) {
                setMessages((current) => current.filter((item) => item.id !== message.id));
              }
            }}
            onOpenChange={(open) => {
              if (!open) {
                setMessages((current) =>
                  current.map((item) => (item.id === message.id ? { ...item, open: false } : item)),
                );
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

        {/* The stylesheet places feedback above the bar or the keyboard. */}
        <RadixToast.Viewport
          data-toasts=""
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col gap-8 px-16 pt-16"
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
