import { ArrowRight, Check } from 'lucide-react';
import { useId } from 'react';

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
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly answer: string;
  readonly alternatives?: readonly string[];
  readonly language: string | undefined;
  readonly revealed: boolean;
  readonly onReveal: () => void;
}) {
  const t = useTranslate();
  const inputId = useId();
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
