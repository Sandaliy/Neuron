import { useEffect, useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';

/** Playback is opt-in so mobile browsers retain the initiating user gesture. */
export function ListeningPrompt({
  text,
  language,
}: {
  readonly text: string;
  readonly language: string | undefined;
}) {
  const t = useTranslate();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    const refresh = () => setVoices(speech.getVoices());
    refresh();
    speech.addEventListener('voiceschanged', refresh);
    return () => {
      speech.removeEventListener('voiceschanged', refresh);
      speech.cancel();
    };
  }, []);
  const voice = voices.find(
    (item) =>
      language && item.lang.toLowerCase().split('-')[0] === language.toLowerCase().split('-')[0],
  );
  return (
    <div className="flex flex-col gap-12">
      <p>{t('study.listenPrompt')}</p>
      <Button
        disabled={!voice}
        onClick={() => {
          try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = voice!;
            utterance.lang = voice!.lang;
            utterance.onerror = () => setFailed(true);
            setFailed(false);
            window.speechSynthesis.speak(utterance);
          } catch {
            setFailed(true);
          }
        }}
      >
        {t('study.replay')}
      </Button>
      {(!voice || failed) && (
        <p role="status" className="text-14 text-secondary">
          {t('study.voiceUnavailable')}
        </p>
      )}
      <p className="text-13 text-secondary">{t('study.listenFallback')}</p>
    </div>
  );
}
