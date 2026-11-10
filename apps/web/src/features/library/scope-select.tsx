import { useId } from 'react';

import { Select } from '../../ui/select';

import type { ChangeEvent, ReactNode } from 'react';

/**
 * Which part of the Library a check looks at, with its label on screen.
 *
 * The select used to show only its value, so a Deck called "Just for test"
 * read as a heading or a filter nobody had set. "Look in" in front of it says
 * what the choice is.
 */
export function ScopeSelect({
  label,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-12">
      <label htmlFor={id} className="shrink-0 text-14 text-secondary">
        {label}
      </label>
      <div className="min-w-0 flex-1">
        <Select id={id} value={value} onChange={onChange}>
          {children}
        </Select>
      </div>
    </div>
  );
}
