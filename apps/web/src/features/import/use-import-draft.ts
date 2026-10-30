import { useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { importDraftVisit, saveImportDraft } from './import-drafts';

import type { ImportDraft, ImportPreparation } from './import-drafts';

/** One Import's autosave, with navigation waiting for the latest committed version. */
export function useImportDraft(initial: ImportDraft) {
  const current = useRef(initial);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const guard = useRef(importDraftVisit(initial.accountId));
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saved' | 'dirty' | 'saving' | 'failed'>(
    initial.revision > 0 ? 'saved' : 'idle',
  );
  const [conflict, setConflict] = useState(false);

  const persist = useCallback((): Promise<boolean> => {
    if (saving.current) return saving.current;
    const run = async () => {
      try {
        guard.current();
        setStatus('saving');
        do {
          const at = version.current;
          const saved = await saveImportDraft(current.current);
          guard.current();
          current.current = { ...current.current, revision: saved.revision };
          savedVersion.current = at;
        } while (savedVersion.current !== version.current);
        setStatus('saved');
        setDraft(current.current);
        setConflict(false);
        return true;
      } catch (error) {
        setStatus('failed');
        setConflict(error instanceof Error && error.message === 'import_draft_conflict');
        return false;
      } finally {
        saving.current = undefined;
      }
    };
    saving.current = run();
    return saving.current;
  }, []);

  function replace(next: ImportDraft) {
    guard.current();
    current.current = { ...next, revision: current.current.revision };
    version.current++;
    setDraft(current.current);
    setStatus('dirty');
  }
  function edit(patch: Partial<ImportPreparation>) {
    replace({ ...current.current, preparation: { ...current.current.preparation, ...patch } });
  }
  function delivery(value: ImportDraft['delivery']) {
    if (value) replace({ ...current.current, delivery: value });
    else {
      const { delivery: _previous, ...rest } = current.current;
      replace(rest);
    }
  }

  useEffect(() => {
    if (status !== 'dirty' || version.current === savedVersion.current) return;
    const timer = setTimeout(() => void persist(), 350);
    return () => clearTimeout(timer);
  }, [draft, status, persist]);

  useEffect(() => {
    const flush = () => {
      if (version.current !== savedVersion.current) void persist();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [persist]);

  const unsaved = status === 'dirty' || status === 'saving' || status === 'failed';
  const navigation = useBlocker({
    withResolver: true,
    shouldBlockFn: () =>
      version.current !== savedVersion.current ? persist().then((ok) => !ok) : false,
    enableBeforeUnload: unsaved,
  });

  return { draft, edit, delivery, persist, status, conflict, navigation, current };
}
