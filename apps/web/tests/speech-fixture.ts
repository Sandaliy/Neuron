import type { Page } from '@playwright/test';

/** Device capability fixture; audio quality remains physical-device acceptance. */
export async function useSpeech(page: Page) {
  await page.addInitScript(() => {
    const speech = new EventTarget();
    const voices = [
      { name: 'Beta', lang: 'de-DE', voiceURI: 'beta', localService: true, default: false },
      { name: 'Alpha', lang: 'de-DE', voiceURI: 'alpha', localService: true, default: false },
      { name: 'English', lang: 'en-US', voiceURI: 'english', localService: true, default: true },
    ];
    Object.assign(speech, {
      getVoices: () => voices,
      cancel: () => {
        document.documentElement.dataset['speechCanceled'] = 'true';
      },
      speak: (utterance: {
        text: string;
        voice: { name: string };
        onerror?: (event: { error: string }) => void;
      }) => {
        document.documentElement.dataset['spokenText'] = utterance.text;
        document.documentElement.dataset['spokenVoice'] = utterance.voice.name;
        if (document.documentElement.dataset['speechFail'])
          utterance.onerror?.({ error: 'synthesis-failed' });
      },
    });
    Object.defineProperty(window, 'speechSynthesis', { value: speech, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        constructor(public text: string) {}
      },
      configurable: true,
    });
  });
}
