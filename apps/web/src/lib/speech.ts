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

// Exact Apple system names observed as effects, not language-learning narration.
const appleEffects = new Set([
  'bad news',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'good news',
  'hysterical',
  'organ',
  'trinoids',
  'whisper',
  'zarvox',
]);
const isApple = (platform: string) => /Mac|iPhone|iPad|iPod/i.test(platform);
const automaticVoice = (voice: SpeechSynthesisVoice, platform: string) =>
  !isApple(platform) || voice.name.trim().toLowerCase() !== 'albert';

/** Exact Deck locale, then a compatible device locale, then stable system metadata. */
export function compatibleVoices(
  voices: readonly SpeechSynthesisVoice[],
  language: string | undefined,
  deviceLanguages: readonly string[] = [],
  platform: string = navigator.platform,
): SpeechSynthesisVoice[] {
  if (!language || !locale(language)) return [];
  const target = locale(language)!;
  const preferred = target.includes('-')
    ? target
    : (deviceLanguages.map(locale).find((value) => value && base(value) === base(target)) ??
      target);
  return voices
    .filter((voice) => base(voice.lang) === base(target))
    .filter((voice) => !isApple(platform) || !appleEffects.has(voice.name.trim().toLowerCase()))
    .sort(
      (a, b) =>
        Number(locale(b.lang) === preferred) - Number(locale(a.lang) === preferred) ||
        Number(b.default) - Number(a.default) ||
        Number(b.localService) - Number(a.localService) ||
        compare(voiceKey(a), voiceKey(b)),
    );
}

/** A small suitable set; an explicit ordinary voice remains visible even outside it. */
export function recommendedVoices(
  compatible: readonly SpeechSynthesisVoice[],
  selected?: SpeechSynthesisVoice,
  platform: string = navigator.platform,
) {
  const recommended = compatible.filter((voice) => automaticVoice(voice, platform)).slice(0, 3);
  if (selected && !recommended.some((voice) => voiceKey(voice) === voiceKey(selected)))
    recommended.push(selected);
  return recommended;
}

export function useSystemVoiceState() {
  const [state, setState] = useState(() => {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    return { voices, ready: !window.speechSynthesis || voices.length > 0 };
  });
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const refresh = () => setState({ voices: speech.getVoices(), ready: true });
    // An empty initial inventory can precede asynchronous voice discovery.
    // Only an actual inventory notification confirms that it is unavailable.
    speech.addEventListener('voiceschanged', refresh);
    if (speech.getVoices().length) refresh();
    return () => speech.removeEventListener('voiceschanged', refresh);
  }, []);
  return state;
}
export function useSystemVoices() {
  return useSystemVoiceState().voices;
}

const preferenceKey = (language: string) => `neuron.speech.voice:${locale(language) ?? language}`;
export function resolveVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string | undefined,
  platform: string = navigator.platform,
) {
  const compatible = compatibleVoices(voices, language, navigator.languages, platform);
  const preference = language ? storage.read(preferenceKey(language)) : undefined;
  return (
    compatible.find((voice) => voiceKey(voice) === preference) ??
    compatible.find((voice) => automaticVoice(voice, platform))
  );
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
