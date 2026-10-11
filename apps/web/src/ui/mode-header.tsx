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
  progressLabel,
  savingLabel,
}: {
  readonly title: string;
  readonly exitLabel: string;
  readonly onExit: () => void;
  readonly disabled?: boolean;
  readonly action?: ReactNode;
  readonly value?: number;
  readonly max?: number;
  readonly progressLabel?: string;
  readonly savingLabel?: string | undefined;
}) {
  return (
    <header className="flex flex-col gap-8">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8">
        <Button
          variant="text"
          className="w-44 justify-self-start text-secondary"
          aria-label={exitLabel}
          title={savingLabel ?? exitLabel}
          busy={!!savingLabel}
          disabled={disabled}
          onClick={() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            onExit();
          }}
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <h1 aria-label={title} className="relative text-17 text-primary">
          <span className={savingLabel ? 'opacity-0' : undefined}>{title}</span>
          {savingLabel && (
            <span
              role="status"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-12 whitespace-nowrap text-secondary"
            >
              {savingLabel}
            </span>
          )}
        </h1>
        <div className="min-w-0 justify-self-end">{action}</div>
      </div>
      {value !== undefined && max !== undefined && (
        <Progress value={value} max={max} label={progressLabel ?? title} />
      )}
    </header>
  );
}
