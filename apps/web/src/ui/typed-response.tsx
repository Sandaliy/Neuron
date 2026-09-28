import { ArrowRight, Check } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { flushSync } from 'react-dom';

import { checkTypedAnswer, spellingFeedback } from '@neuron/shared';

import { useTranslate } from '../i18n/locale';

import { Button } from './button';
import { Input } from './input';

/** Feedback belongs to the submitted response, never to the scheduling decision. */
export function TypedResponse({
  value,
  onChange,
  answer,
  alternatives = [],
  language,
  revealed,
  onReveal,
  ready,
  onReadyChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly answer: string;
  readonly alternatives?: readonly string[];
  readonly language: string | undefined;
  readonly revealed: boolean;
  readonly onReveal: () => void;
  readonly ready: boolean;
  readonly onReadyChange: (ready: boolean) => void;
}) {
  const t = useTranslate();
  const inputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const stopWaitingForKeyboard = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopWaitingForKeyboard.current?.(), []);
  function leaveKeyboardReadyAfterClose() {
    stopWaitingForKeyboard.current?.();
    const viewport = window.visualViewport;
    if (!viewport) {
      onReadyChange(false);
      return;
    }
    const finish = () => {
      // This is a one-time exit signal, never a source for learning geometry.
      if (window.innerHeight - viewport.height > 120) return;
      viewport.removeEventListener('resize', finish);
      window.removeEventListener('resize', finish);
      stopWaitingForKeyboard.current = undefined;
      onReadyChange(false);
    };
    stopWaitingForKeyboard.current = () => {
      viewport.removeEventListener('resize', finish);
      window.removeEventListener('resize', finish);
    };
    viewport.addEventListener('resize', finish);
    window.addEventListener('resize', finish);
    finish();
  }
  const comparison = spellingFeedback(value, answer, alternatives, language);
  const outcome = checkTypedAnswer(value, answer, alternatives, language);
  const accepted = outcome === 'exact' || outcome === 'correct';
  const errors = comparison.parts.filter((part) => part.kind !== 'correct');
  const result = accepted
    ? t('study.answerAccepted')
    : outcome === 'incorrect'
      ? t('study.answerIncorrect')
      : errors.length === 1
        ? t(
            errors[0]!.kind === 'extra'
              ? 'study.extraLetter'
              : errors[0]!.kind === 'missing'
                ? 'study.missingLetter'
                : 'study.changedLetter',
          )
        : t('study.answerChanges', { count: errors.length });
  const parts =
    outcome === 'incorrect' ? [{ kind: 'incorrect' as const, text: value }] : comparison.parts;
  return (
    <form
      ref={formRef}
      className="neu-response flex shrink-0 flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) {
          (event.currentTarget.elements.namedItem('typed-answer') as HTMLInputElement)?.blur();
          onReveal();
        }
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {t('study.typeAnswer')}
      </label>
      {revealed ? (
        <div role="status" className="flex flex-col gap-8">
          <div
            className="neu-spelling rounded-12 bg-input px-16 py-12 text-20"
            aria-label={`${t('study.yourAnswer')}: ${value}. ${result}`}
          >
            {parts.map((part, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={
                  part.kind === 'correct'
                    ? 'text-correct'
                    : 'text-error underline decoration-2 underline-offset-4'
                }
              >
                {part.kind === 'missing' ? (
                  <span className="inline-block border-b-2 border-dotted">{part.text}</span>
                ) : (
                  part.text
                )}
              </span>
            ))}
          </div>
          <p className="flex items-center gap-4 text-13 text-secondary">
            {accepted && <Check size={16} className="text-correct" aria-hidden="true" />}
            {result}
          </p>
          <span className="sr-only">
            {comparison.answer}.{' '}
            {errors
              .map((part) =>
                t(`study.spelling.${part.kind}`, {
                  text: part.text,
                  expected: part.expected ?? part.text,
                }),
              )
              .join(' ')}
          </span>
        </div>
      ) : !ready ? (
        <Button
          type="button"
          data-typing-activator=""
          className="min-h-44 w-full justify-start rounded-12 border border-default bg-input px-16 text-16 text-tertiary"
          onClick={() => {
            // iOS requires focus in the activation gesture. Commit the safe
            // geometry first, then focus the input synchronously in that tap.
            flushSync(() => onReadyChange(true));
            const input = formRef.current?.querySelector<HTMLInputElement>('[data-typed-answer]');
            input?.getBoundingClientRect();
            input?.focus({ preventScroll: true });
          }}
        >
          {t('study.typeAnswer')}
        </Button>
      ) : (
        <div className="grid grid-cols-[1fr_44px] items-center gap-8">
          <Input
            id={inputId}
            data-typed-answer=""
            name="typed-answer"
            value={value}
            placeholder={t('study.typeAnswer')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={500}
            onChange={(event) => onChange(event.target.value)}
            onBlur={leaveKeyboardReadyAfterClose}
          />
          <Button
            type="submit"
            variant="primary"
            className="size-44 p-8"
            aria-label={t('study.checkAnswer')}
            disabled={!value.trim()}
          >
            <ArrowRight size={20} aria-hidden="true" />
          </Button>
        </div>
      )}
    </form>
  );
}
