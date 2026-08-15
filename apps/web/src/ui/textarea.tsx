import type { TextareaHTMLAttributes } from 'react';

/** A field for something longer than a line. The same skin as the text field. */
export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export function TextArea({ invalid = false, className = '', rows = 3, ...rest }: TextAreaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={[
        'w-full resize-y rounded-12 border bg-input px-16 py-12 text-15 text-primary',
        'transition-[border-color] placeholder:text-tertiary',
        'disabled:cursor-not-allowed disabled:border-subtle disabled:bg-sunken disabled:text-disabled',
        invalid ? 'border-error' : 'border-default hover:border-strong',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
