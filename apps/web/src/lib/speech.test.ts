import { describe, expect, it } from 'vitest';

import { compatibleVoices, preferVoice, recommendedVoices, resolveVoice, voiceKey } from './speech';

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
  it('excludes named Apple effects while keeping ordinary voices and locale priority', () => {
    const effects = [
      'Bad News',
      'Bells',
      'Boing',
      'Bubbles',
      'Cellos',
      'Organ',
      'Whisper',
      'Zarvox',
    ];
    const apple = [
      ...effects.map((name) => voice(name, 'en-US', true)),
      voice('Samantha', 'en-US'),
      voice('Daniel', 'en-GB', true),
      voice('Anna', 'de-DE'),
    ];
    expect(compatibleVoices(apple, 'en-US', [], 'MacIntel').map((item) => item.name)).toEqual([
      'Samantha',
      'Daniel',
    ]);
    expect(compatibleVoices(apple, 'en-GB', [], 'iPhone')[0]?.name).toBe('Daniel');
    expect(compatibleVoices(apple, 'de', [], 'iPad').map((item) => item.name)).toEqual(['Anna']);
    expect(compatibleVoices(apple, 'en', [], 'Win32')).toHaveLength(effects.length + 2);
  });
  it('avoids Albert automatically, preserves explicit human choices and falls back deterministically', () => {
    const apple = [
      voice('Albert', 'en-US', true),
      voice('Samantha', 'en-US'),
      voice('Daniel', 'en-GB'),
    ];
    preferVoice('en', 'missing');
    expect(resolveVoice(apple, 'en', 'MacIntel')?.name).toBe('Samantha');
    preferVoice('en', voiceKey(apple[0]!));
    expect(resolveVoice(apple, 'en', 'iPhone')?.name).toBe('Albert');
    expect(resolveVoice(apple.slice(1).reverse(), 'en', 'iPhone')?.name).toBe('Samantha');
    preferVoice('en', voiceKey(voice('Bells', 'en-US')));
    expect(resolveVoice([voice('Bells', 'en-US'), ...apple], 'en', 'MacIntel')?.name).toBe(
      'Samantha',
    );
    expect(
      resolveVoice([apple[0]!, voice('Zarvox', 'en-US'), voice('Anna', 'de-DE')], 'en', 'MacIntel'),
    ).toBeUndefined();
  });
  it('prefers a suitable default within a locale and exposes a small set plus explicit selection', () => {
    const pool = ['Amy', 'Brian', 'Daniel', 'Emma', 'Samantha'].map((name) =>
      voice(name, 'en-US', name === 'Samantha'),
    );
    const compatible = compatibleVoices(pool, 'en-US', [], 'MacIntel');
    expect(compatible[0]?.name).toBe('Samantha');
    expect(recommendedVoices(compatible, undefined, 'MacIntel')).toHaveLength(3);
    expect(recommendedVoices(compatible, pool[3], 'MacIntel').map((item) => item.name)).toEqual([
      'Samantha',
      'Amy',
      'Brian',
      'Emma',
    ]);
    expect(compatibleVoices([...pool].reverse(), 'en-US', [], 'MacIntel')).toEqual(compatible);
  });
});
