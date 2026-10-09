import { createContext, useCallback, useContext, useState } from 'react';

import type { LanguageCode } from '@neuron/shared';

import { DEFAULT_CARD_DISPLAY } from './card-display';

import type { CardDisplay } from './card-display';
import type { ReactNode } from 'react';

interface StudyDraft {
  readonly minutes: string;
  readonly scope?: string[] | undefined;
  readonly language?: LanguageCode | null;
  readonly direction: string;
  readonly display: CardDisplay;
  readonly override: boolean;
}
const INITIAL: StudyDraft = {
  minutes: '',
  direction: '',
  display: DEFAULT_CARD_DISPLAY,
  override: false,
};
const DraftContext = createContext<{
  draft: StudyDraft;
  change: (draft: StudyDraft) => void;
  finish: () => void;
} | null>(null);

/** Mounted once per authenticated visit; temporary scope never becomes participation. */
export function StudyDraftProvider({ children }: { readonly children: ReactNode }) {
  const [draft, change] = useState(INITIAL);
  const finish = useCallback(
    () =>
      change((value) => ({
        ...value,
        scope: undefined,
        minutes: '',
        override: false,
      })),
    [],
  );
  return (
    <DraftContext.Provider value={{ draft, change, finish }}>{children}</DraftContext.Provider>
  );
}
export function useStudyDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error('Study draft requires an authenticated visit');
  return value;
}
