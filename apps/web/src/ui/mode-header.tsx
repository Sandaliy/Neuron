import { X } from 'lucide-react';

import { Button } from './button';
import { Progress } from './progress';

import type { ReactNode } from 'react';

/** Equal side slots keep the mode title centered regardless of action width. */
export function ModeHeader({
  title,
  exitLabel,
  onExit,
  disabled = false,
  action,
  value,
  max,
}: {
  readonly title: string;
  readonly exitLabel: string;
  readonly onExit: () => void;
  readonly disabled?: boolean;
  readonly action?: ReactNode;
  readonly value?: number;
  readonly max?: number;
}) {
  return (
    <header className="flex flex-col gap-8">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8">
        <Button
          variant="text"
          className="w-44 justify-self-start text-secondary"
          aria-label={exitLabel}
          title={exitLabel}
          disabled={disabled}
          onClick={onExit}
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <h1 className="text-14 text-secondary">{title}</h1>
        <div className="min-w-0 justify-self-end">{action}</div>
      </div>
      {value !== undefined && max !== undefined && (
        <Progress value={value} max={max} label={title} />
      )}
    </header>
  );
}
