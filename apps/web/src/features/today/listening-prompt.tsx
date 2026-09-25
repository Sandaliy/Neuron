import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { Button } from '../../ui/button';

/** Playback is opt-in so mobile browsers retain the initiating user gesture. */
export function Speaker({
  text,
  language,
  compact = true,
}: {
  readonly compact?: boolean;
  readonly text: string;
  readonly language: string | undefined;
}) {
  const t = useTranslate();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    const refresh = () => {
      setVoices(speech.getVoices());
      setFailed(false);
    };
    refresh();
    speech.addEventListener('voiceschanged', refresh);
    return () => {
      speech.removeEventListener('voiceschanged', refresh);
      speech.cancel();
    };
  }, [text, language]);
  const voice = voices.find(
    (item) =>
      language && item.lang.toLowerCase().split('-')[0] === language.toLowerCase().split('-')[0],
  );
  return (
    <span
      className={
        compact ? 'inline-flex flex-wrap items-center align-middle' : 'flex flex-col gap-12'
      }
    >
      {!compact && <span>{t('study.listenPrompt')}</span>}
      <Button
        variant="text"
        className={compact ? 'ml-4 inline-flex size-44 p-8' : 'self-start'}
        aria-label={t('study.replay')}
        title={t(!voice || failed ? 'study.voiceUnavailable' : 'study.replay')}
        disabled={!voice && !compact}
        onClick={() => {
          if (!voice) {
            setFailed(true);
            return;
          }
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
        <Volume2 size={24} strokeWidth={1.5} aria-hidden="true" />
        {!compact && t('study.replay')}
      </Button>
      {(failed || (!voice && !compact)) && (
        <span role="status" className="block text-14 leading-read text-secondary">
          {t('study.voiceUnavailable')}
        </span>
      )}
      {!compact && <span className="text-13 text-secondary">{t('study.listenFallback')}</span>}
    </span>
  );
}

export function ListeningPrompt(props: {
  readonly text: string;
  readonly language: string | undefined;
}) {
  return <Speaker {...props} compact={false} />;
}
