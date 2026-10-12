import { useId } from 'react';

import type { EditorField } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { TextArea } from '../../ui/textarea';

import type { KeyboardEvent } from 'react';

export function NoteField({
  field,
  value,
  onChange = () => undefined,
  readOnly = false,
}: {
  readonly field: EditorField;
  readonly value: unknown;
  readonly onChange?: (value: string | boolean | undefined) => void;
  readonly readOnly?: boolean;
}) {
  const t = useTranslate();
  const id = useId();
  const text = typeof value === 'string' ? value : '';

  function advance(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();

    const form = event.currentTarget.closest('[data-screen]');
    const focusable = [
      ...(form?.querySelectorAll<HTMLElement>('input, select, textarea') ?? []),
    ].filter((element) => !element.closest('[inert]') && !element.matches(':disabled'));
    const next = focusable[focusable.indexOf(event.currentTarget) + 1];

    next?.focus();
  }

  if (readOnly) {
    const choice = field.options?.find((option) => option.value === value);
    const display =
      typeof value === 'boolean'
        ? t(value ? 'practice.yes' : 'practice.no')
        : choice?.labelKey
          ? t(choice.labelKey)
          : typeof value === 'string'
            ? value
            : Array.isArray(value)
              ? value.join(', ')
              : '';
    return (
      <div data-field="" className="flex flex-col gap-8">
        <p id={id} className="text-13 font-semibold text-secondary">
          {t(field.labelKey)}
        </p>
        <p
          aria-labelledby={id}
          className="min-h-44 whitespace-pre-wrap break-words text-17 leading-read text-primary"
        >
          {display}
        </p>
      </div>
    );
  }
  if (field.kind === 'toggle')
    return (
      <div data-field="" className="flex flex-col gap-8">
        <label htmlFor={id} className="cursor-pointer text-13 font-semibold text-secondary">
          {t(field.labelKey)}
        </label>
        <div className="neu-note-toggle-control flex items-center text-16">
          <Switch id={id} label={t(field.labelKey)} checked={value === true} onChange={onChange} />
        </div>
      </div>
    );
  return (
    <FormField
      label={t(field.labelKey)}
      {...(field.hintKey === undefined ? {} : { hint: t(field.hintKey) })}
    >
      {(props) => {
        if (field.kind === 'choice') {
          return (
            <Select {...props} value={text} onChange={(event) => onChange(event.target.value)}>
              <option value="">{t('library.notSet')}</option>
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.labelKey ? t(option.labelKey) : option.value}
                </option>
              ))}
            </Select>
          );
        }

        if (field.kind === 'multiline') {
          return (
            <TextArea
              {...props}
              value={text}
              rows={2}
              onChange={(event) => onChange(event.target.value)}
            />
          );
        }

        return (
          <Input
            {...props}
            value={text}
            autoComplete="off"
            enterKeyHint="next"
            onKeyDown={advance}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      }}
    </FormField>
  );
}
