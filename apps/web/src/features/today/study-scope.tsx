import { Folder, Layers } from 'lucide-react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useDialogState } from '../../lib/dialog-state';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Dialog, DialogBody, DialogFooter } from '../../ui/dialog';

export function StudyScope({
  open,
  onOpenChange,
  decks,
  collections,
  selected,
  onApply,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly decks: readonly DeckNode[];
  readonly collections: readonly DeckNode[];
  readonly selected: readonly string[] | undefined;
  readonly onApply: (ids: string[] | undefined) => void;
}) {
  const t = useTranslate();
  const defaults = decks
    .filter((deck) => deck.settings?.dailyStudyIncluded !== false)
    .map((deck) => deck.id);
  const [draft, setDraft] = useDialogState<readonly string[] | undefined>(open, selected);
  const chosen = draft ?? defaults;
  const visible = new Set(decks.map((deck) => deck.id));
  for (const deck of decks) {
    const seen = new Set<string>();
    let parent = deck.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const row = collections.find((item) => item.id === parent);
      if (!row) break;
      visible.add(row.id);
      parent = row.parentId;
    }
  }
  const rows = collections.filter((row) => visible.has(row.id));
  function leaves(row: DeckNode): string[] {
    return row.kind === 'deck'
      ? [row.id]
      : rows.filter((child) => child.parentId === row.id).flatMap(leaves);
  }
  function render(parentId: string | null): React.ReactNode {
    return rows
      .filter((row) => row.parentId === parentId)
      .map((row) => {
        const ids = leaves(row);
        const count = ids.filter((id) => chosen.includes(id)).length;
        const folder = row.kind === 'folder';
        return (
          <div key={row.id}>
            <Checkbox
              checked={count === ids.length ? true : count ? 'indeterminate' : false}
              onChange={(checked) =>
                setDraft(
                  checked
                    ? [...new Set([...chosen, ...ids])]
                    : chosen.filter((id) => !ids.includes(id)),
                )
              }
            >
              <span className="flex items-center gap-8 text-15 text-primary">
                {folder ? (
                  <Folder size={16} aria-hidden="true" />
                ) : (
                  <Layers size={16} aria-hidden="true" />
                )}
                {row.name}
              </span>
              {!folder && (
                <span className="block text-12 text-secondary">
                  {t(
                    row.settings?.dailyStudyIncluded === false
                      ? 'study.paused'
                      : 'study.dailyParticipant',
                  )}
                </span>
              )}
            </Checkbox>
            {folder && <div className="ml-12 border-l border-subtle pl-8">{render(row.id)}</div>}
          </div>
        );
      });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('study.scope')}
      description={t('study.scopeTemporary')}
    >
      <DialogBody>
        <p role="status" className="text-13 text-secondary">
          {t(draft === undefined ? 'study.scopeDaily' : 'study.scopeCustom')}
        </p>
        {draft !== undefined && (
          <Button variant="text" className="self-start" onClick={() => setDraft(undefined)}>
            {t('study.useDailyDecks')}
          </Button>
        )}
        <div className="flex flex-col">{render(null)}</div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="primary"
          full
          onClick={() => {
            onApply(draft === undefined ? undefined : [...draft]);
            onOpenChange(false);
          }}
        >
          {t('common.apply')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
