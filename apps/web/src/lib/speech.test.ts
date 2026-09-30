import { describe, expect, it } from 'vitest';

import { compatibleVoices, preferVoice, resolveVoice, voiceKey } from './speech';

const voice = (name: string, lang: string, defaults = false) =>
  ({ name, lang, voiceURI: name, default: defaults, localService: true }) as SpeechSynthesisVoice;
const voices = [
  voice('Zulu', 'de-DE'),
  voice('English', 'en-US', true),
  voice('Anna', 'de-AT'),
  voice('Beta', 'de-DE'),
];
describe('system voice resolution', () => {
  it('prefers exact locales, then compatible device locales, independent of arrival order', () => {
    expect(compatibleVoices(voices, 'de-AT')[0]?.name).toBe('Anna');
    expect(compatibleVoices(voices, 'de', ['en-US', 'de-DE'])[0]?.name).toBe('Beta');
    expect(compatibleVoices([...voices].reverse(), 'de')).toEqual(compatibleVoices(voices, 'de'));
    expect(compatibleVoices(voices, 'fr')).toEqual([]);
    expect(compatibleVoices(voices, undefined)).toEqual([]);
    expect(compatibleVoices(voices, '???')).toEqual([]);
  });
  it('uses a compatible device preference and falls back when the voice disappears', () => {
    preferVoice('de', voiceKey(voices[0]!));
    expect(resolveVoice(voices, 'de')?.name).toBe('Zulu');
    expect(resolveVoice(voices.slice(1), 'de')?.lang.startsWith('de')).toBe(true);
    preferVoice('de', voiceKey(voices[1]!));
    expect(resolveVoice(voices, 'de')?.lang.startsWith('de')).toBe(true);
  });
});
