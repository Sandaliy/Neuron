import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Read off disk rather than imported.
 *
 * Vitest hands back an empty string for a css import, `?raw` included, unless
 * css handling is switched on for the whole project, and `new URL(path,
 * import.meta.url)` is rewritten by Vite into a dev server url. `join` is the
 * one form that means the file.
 */
const tokens = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/config/tokens.css'),
  'utf8',
);

/**
 * Both themes have to be legible, and "looks fine to me" is not a measurement.
 *
 * WCAG AA asks for 4.5 to 1 on body text. This reads the tokens out of the
 * stylesheet and measures the pairs that actually appear on screen, so a colour
 * changed for looking nicer cannot quietly drop below the line.
 */
/** The variables defined in one block of the token file. */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector);
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('}', start));
  const found: Record<string, string> = {};

  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    if (name && value) {
      found[name] = value;
    }
  }

  return found;
}

const dark = block(':root');
const light = { ...dark, ...block("[data-theme='light']") };

/** Relative luminance, as WCAG defines it. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** The contrast between two colours, from 1 to 21. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];

  return (high + 0.05) / (low + 0.05);
}

const AA = 4.5;

describe('the themes', () => {
  const pairs: readonly { theme: string; what: string; front: string; back: string }[] = [
    { theme: 'dark', what: 'primary text', front: 'text', back: 'bg' },
    { theme: 'dark', what: 'secondary text', front: 'text-dim', back: 'bg' },
    { theme: 'dark', what: 'primary text on a card', front: 'text', back: 'surface' },
    { theme: 'dark', what: 'secondary text on a card', front: 'text-dim', back: 'surface' },
    { theme: 'dark', what: 'a label on the accent', front: 'accent-text', back: 'accent' },
    { theme: 'light', what: 'primary text', front: 'text', back: 'bg' },
    { theme: 'light', what: 'secondary text', front: 'text-dim', back: 'bg' },
    { theme: 'light', what: 'primary text on a card', front: 'text', back: 'surface' },
    { theme: 'light', what: 'secondary text on a card', front: 'text-dim', back: 'surface' },
    { theme: 'light', what: 'a label on the accent', front: 'accent-text', back: 'accent' },
  ];

  for (const { theme, what, front, back } of pairs) {
    it(`meets AA for ${what} in the ${theme} theme`, () => {
      const palette = theme === 'dark' ? dark : light;
      const foreground = palette[front];
      const background = palette[back];

      expect(foreground, `--${front} in ${theme}`).toBeDefined();
      expect(background, `--${back} in ${theme}`).toBeDefined();

      const measured = contrast(foreground as string, background as string);

      // Printed on every run, because the number is the point: the report is
      // what somebody reads when they change a colour.
      console.log(`${theme} ${what}: ${measured.toFixed(2)} to 1`);

      expect(measured).toBeGreaterThanOrEqual(AA);
    });
  }
});
