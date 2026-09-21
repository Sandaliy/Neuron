import { Card } from './card';

import type { ReactNode } from 'react';

/** A reading surface shared by scheduled study and independent Practice. */
export function LearningCard({
  context,
  prompt,
  answer,
  identity,
}: {
  readonly context: ReactNode;
  readonly prompt: ReactNode;
  readonly answer?: ReactNode;
  readonly identity?: string;
}) {
  return (
    <Card className="flex min-h-[320px] flex-1 flex-col gap-24 break-words">
      <div className="text-12 text-secondary">{context}</div>
      <div key={identity} className="neu-reveal flex flex-1 flex-col gap-24 py-24">
        <div className="flex min-h-[120px] flex-col justify-center font-display text-32 leading-body tracking-tight text-primary">
          {prompt}
        </div>
        {answer && (
          <div className="neu-reveal border-t border-subtle pt-24 text-24 leading-body text-primary">
            {answer}
          </div>
        )}
      </div>
    </Card>
  );
}
