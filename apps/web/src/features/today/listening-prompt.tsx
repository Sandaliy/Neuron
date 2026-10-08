import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useTranslate } from '../../i18n/locale';
import { resolveVoice, speak, useSystemVoices } from '../../lib/speech';
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
  const voices = useSystemVoices();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    return () => {
      speech.cancel();
    };
  }, [text, language]);
  const voice = resolveVoice(voices, language);
  return (
    <span
      className={
        compact
          ? 'inline-flex shrink-0 items-center align-middle'
          : 'flex flex-col items-start gap-16'
      }
    >
      {!compact && <span className="text-20 leading-read">{t('study.listenPrompt')}</span>}
      <Button
        variant={compact ? 'text' : 'quiet'}
        className={compact ? 'inline-flex size-44 p-8' : 'self-start'}
        aria-label={t('study.replay')}
        title={t(!voice || failed ? 'study.voiceUnavailable' : 'study.replay')}
        disabled={!voice && !compact}
        onClick={() => {
          if (!voice) {
            setFailed(true);
            return;
          }
          setFailed(false);
          speak(text, voice, () => setFailed(true));
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
    </span>
  );
}

export function ListeningPrompt(props: {
  readonly text: string;
  readonly language: string | undefined;
}) {
  return <Speaker {...props} compact={false} />;
}
