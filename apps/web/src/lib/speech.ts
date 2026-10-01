import { useEffect, useState } from 'react';

import * as storage from './storage';

function locale(value: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(value.replaceAll('_', '-'))[0];
  } catch {
    return undefined;
  }
}
const base = (value: string) => locale(value)?.split('-')[0];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const voiceKey = (voice: SpeechSynthesisVoice) =>
  `${voice.lang}|${voice.name}|${voice.voiceURI}`;

/** Exact Deck locale, then a compatible device locale, then stable system metadata. */
export function compatibleVoices(
  voices: readonly SpeechSynthesisVoice[],
  language: string | undefined,
  deviceLanguages: readonly string[] = [],
): SpeechSynthesisVoice[] {
  if (!language || !locale(language)) return [];
  const target = locale(language)!;
  const preferred = target.includes('-')
    ? target
    : (deviceLanguages.map(locale).find((value) => value && base(value) === base(target)) ??
      target);
  return voices
    .filter((voice) => base(voice.lang) === base(target))
    .sort(
      (a, b) =>
        Number(locale(b.lang) === preferred) - Number(locale(a.lang) === preferred) ||
        Number(b.default) - Number(a.default) ||
        Number(b.localService) - Number(a.localService) ||
        compare(voiceKey(a), voiceKey(b)),
    );
}

export function useSystemVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    const refresh = () => setVoices(speech.getVoices());
    refresh();
    speech.addEventListener('voiceschanged', refresh);
    return () => speech.removeEventListener('voiceschanged', refresh);
  }, []);
  return voices;
}

const preferenceKey = (language: string) => `neuron.speech.voice:${locale(language) ?? language}`;
export function resolveVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string | undefined,
) {
  const compatible = compatibleVoices(voices, language, navigator.languages);
  const preference = language ? storage.read(preferenceKey(language)) : undefined;
  return compatible.find((voice) => voiceKey(voice) === preference) ?? compatible[0];
}
export function preferVoice(language: string, key: string) {
  storage.write(preferenceKey(language), key);
}
export function speak(text: string, voice: SpeechSynthesisVoice, onError: () => void) {
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') onError();
    };
    window.speechSynthesis.speak(utterance);
  } catch {
    onError();
  }
}
