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
  function path(deck: DeckNode) {
    const names: string[] = [];
    const seen = new Set<string>();
    let parent = deck.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const row = collections.find((item) => item.id === parent);
      if (!row) break;
      names.unshift(row.name);
      parent = row.parentId;
    }
    return names.join(' / ');
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('study.scope')}
      description={t('study.scopeTemporary')}
    >
      <DialogBody>
        <div className="flex flex-wrap gap-8">
          <Button aria-pressed={draft === undefined} onClick={() => setDraft(undefined)}>
            {t('study.scopeDefault')}
          </Button>
          <Button onClick={() => setDraft(decks.map((deck) => deck.id))}>
            {t('study.scopeAll')}
          </Button>
          <Button variant="text" onClick={() => setDraft([])}>
            {t('study.scopeNone')}
          </Button>
        </div>
        <div className="flex flex-col">
          {decks.map((deck) => (
            <Checkbox
              key={deck.id}
              checked={chosen.includes(deck.id)}
              onChange={(checked) =>
                setDraft(checked ? [...chosen, deck.id] : chosen.filter((id) => id !== deck.id))
              }
            >
              <span className="text-15 text-primary">{deck.name}</span>
              {path(deck) && <span className="block text-12 text-secondary">{path(deck)}</span>}
              {deck.settings?.dailyStudyIncluded === false && (
                <span className="ml-8 text-12 text-secondary">{t('study.paused')}</span>
              )}
            </Checkbox>
          ))}
        </div>
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
