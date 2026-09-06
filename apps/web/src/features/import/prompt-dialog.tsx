import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { PROMPT_VARIANTS, fillPrompt, missingFromPrompt } from '@neuron/shared';
import type { DeckNode, MessageKey, PromptVariant } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { settingsFor } from '../../lib/decks';
import { PROMPTS } from '../../lib/prompt';
import { Button } from '../../ui/button';
import { Panel } from '../../ui/card';
import { DIALOG_FORM, Dialog, DialogBody, DialogFooter } from '../../ui/dialog';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';

/**
 * The prompt, filled in for this deck and put on the clipboard.
 *
 * The text is not in this file. It is in `docs/card-generation-prompt.md`,
 * imported as text, so there is one copy of it and editing the document is the
 * whole of editing the prompt.
 *
 * The example is shown next to the choice on purpose. A model that answered in
 * the wrong shape is cheapest to notice before five thousand rows are pasted
 * back, and the only way to notice is to know what the right shape looks like.
 */
export function PromptDialog({
  open,
  onOpenChange,
  deck,
  decks,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The deck the prompt is being written for. */
  readonly deck: DeckNode | undefined;
  /** The whole tree, since the deck's languages may be inherited. */
  readonly decks: readonly DeckNode[];
}) {
  const t = useTranslate();
  const [variant, setVariant] = useState<PromptVariant>('vocabulary');
  const [copied, setCopied] = useState(false);

  const prompt = PROMPTS.find((entry) => entry.variant === variant);
  const settings = settingsFor(decks, deck?.id ?? '');
  const filled = fillPrompt(prompt?.text ?? '', {
    ...(settings.targetLanguage === undefined ? {} : { targetLanguage: settings.targetLanguage }),
    ...(settings.nativeLanguage === undefined ? {} : { nativeLanguage: settings.nativeLanguage }),
    ...(settings.level === undefined ? {} : { level: settings.level }),
    deckName: deck?.name ?? '',
  });
  const missing = missingFromPrompt(filled);

  async function copy() {
    try {
      await navigator.clipboard.writeText(filled);
      setCopied(true);
    } catch {
      // Refused, which happens over plain http and in some private windows.
      // The text is on screen and can be selected, so nothing is lost.
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('import.copyPrompt')}>
      <form className={DIALOG_FORM} onSubmit={(event) => event.preventDefault()}>
        <DialogBody>
          <FormField
            label={t('prompt.variant')}
            {...(missing.length > 0 ? { hint: t('prompt.missing') } : {})}
          >
            {(props) => (
              <Select
                {...props}
                value={variant}
                onChange={(event) => {
                  setVariant(event.target.value as PromptVariant);
                  setCopied(false);
                }}
              >
                {PROMPT_VARIANTS.map((option) => (
                  <option key={option} value={option}>
                    {t(`prompt.variant.${option}` as MessageKey)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <p className="text-13 leading-body text-secondary">
            {t(`prompt.about.${variant}` as MessageKey)}
          </p>

          <div className="flex flex-col gap-8">
            <p className="text-13 text-tertiary">{t('prompt.example')}</p>

            <Panel className="max-h-[180px] overflow-auto">
              <pre className="font-mono text-12 leading-body whitespace-pre-wrap text-secondary">
                {prompt?.example}
              </pre>
            </Panel>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="primary" full onClick={() => void copy()}>
            {copied ? (
              <Check size={16} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
            {copied ? t('prompt.copied') : t('import.copyPrompt')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
