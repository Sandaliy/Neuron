import { useEffect, useState } from 'react';

import type { DeckNode } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { useAccount } from '../../lib/account';
import { describe } from '../../lib/api';
import { settingsFor, useDeckActions } from '../../lib/decks';
import {
  compatibleVoices,
  preferVoice,
  resolveVoice,
  speak,
  useSystemVoices,
  voiceKey,
} from '../../lib/speech';
import { Button } from '../../ui/button';
import { Select } from '../../ui/select';
import { useToast } from '../../ui/toast';
import { DeckSettingsDialog } from '../library/deck-dialogs';

export function useListeningAvailability(
  decks: readonly DeckNode[],
  selected: readonly DeckNode[],
) {
  const account = useAccount();
  const voices = useSystemVoices();
  return selected.map((deck) => {
    const language =
      settingsFor(decks, deck.id).targetLanguage ?? account.data?.settings.targetLanguage;
    return { deck, language, voice: resolveVoice(voices, language) };
  });
}

/** Deck settings remain the owner of language; system voice IDs stay on this device. */
export function ListeningSetup({
  decks,
  selected,
}: {
  readonly decks: readonly DeckNode[];
  readonly selected: readonly DeckNode[];
}) {
  const t = useTranslate();
  const toast = useToast();
  const actions = useDeckActions();
  const availability = useListeningAvailability(decks, selected);
  const voices = useSystemVoices();
  const [editing, setEditing] = useState<DeckNode>();
  const [, rerender] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return (
    <div className="flex flex-col gap-8 text-13 text-secondary">
      {availability
        .filter((item) => !item.voice)
        .map(({ deck, language }) => (
          <div key={deck.id} className="flex flex-col gap-4" role="status">
            <p>
              {deck.name}: {t(language ? 'study.voiceUnavailable' : 'study.languageRequired')}
            </p>
            <Button variant="text" className="self-start px-8" onClick={() => setEditing(deck)}>
              {t('library.targetLanguage')}
            </Button>
          </div>
        ))}
      {[...new Set(availability.map((item) => item.language))].flatMap((language) => {
        if (!language) return [];
        const compatible = compatibleVoices(voices, language, navigator.languages);
        const voice = resolveVoice(voices, language);
        if (compatible.length < 2 || !voice) return [];
        return (
          <div key={language} className="flex items-end gap-8">
            <label className="flex min-w-0 flex-1 flex-col gap-4">
              {t('study.systemVoice')} · {language}
              <Select
                value={voiceKey(voice)}
                onChange={(event) => {
                  window.speechSynthesis?.cancel();
                  preferVoice(language, event.target.value);
                  setFailed(false);
                  rerender((value) => value + 1);
                }}
              >
                {compatible.map((item) => (
                  <option key={voiceKey(item)} value={voiceKey(item)}>
                    {item.name} · {item.lang}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              onClick={() => {
                setFailed(false);
                const sample =
                  new Intl.DisplayNames([voice.lang], { type: 'language' }).of(language) ??
                  language;
                speak(sample, voice, () => setFailed(true));
              }}
            >
              {t('study.previewVoice')}
            </Button>
          </div>
        );
      })}
      {failed && <p role="status">{t('study.voiceUnavailable')}</p>}
      {editing && (
        <DeckSettingsDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
          deck={editing}
          decks={decks}
          busy={actions.update.isPending}
          onSave={(settings) => {
            void actions.update
              .mutateAsync({ id: editing.id, settings })
              .then(() => setEditing(undefined))
              .catch((error) => toast.show(t(describe(error).key)));
          }}
        />
      )}
    </div>
  );
}
