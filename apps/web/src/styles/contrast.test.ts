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
 *
 * The glass rows are the interesting ones. A blurred bar is a tint over
 * whatever is scrolling underneath, so the worst case that can really happen is
 * the layer sitting directly over a primary-text glyph of the opposite tone.
 * That is the case measured here, and it is why tertiary text is banned on
 * glass and corrected to secondary by the stylesheet.
 */

/** Every `--name: #value` in one block of the token file. */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector);
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('\n}', start));
  const found: Record<string, string> = {};

  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    if (name && value) {
      found[name] = value;
    }
  }

  // The semantic layer mostly points at raw names, so resolve one hop.
  for (const [, name, target] of body.matchAll(/--([\w-]+):\s*var\(--([\w-]+)\)/g)) {
    const raw = name && target ? block(':root')[target] : undefined;

    if (name && raw) {
      found[name] = raw;
    }
  }

  return found;
}

const raw = block(':root');
const dark = { ...raw, ...block("[data-theme='dark']") };
const light = { ...raw, ...block("[data-theme='light']") };

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
}

/** Relative luminance, as WCAG defines it. */
function luminance([r, g, b]: Rgb): number {
  const [x, y, z] = [r, g, b].map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;

  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
}

/** The contrast between two colours, from 1 to 21. */
function contrast(front: Rgb, back: Rgb): number {
  const [high, low] = [luminance(front), luminance(back)].sort((a, b) => b - a) as [number, number];

  return (high + 0.05) / (low + 0.05);
}

/** A translucent tint over whatever is behind it. */
function over(tint: Rgb, alpha: number, behind: Rgb): Rgb {
  return tint.map((channel, index) => channel * alpha + (behind[index] ?? 0) * (1 - alpha)) as Rgb;
}

/** `--scrim`, which is written as an rgba rather than a hex. */
function scrimOf(selector: string): { colour: Rgb; alpha: number } {
  const start = tokens.indexOf(selector);
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('\n}', start));
  const found = /--scrim:\s*rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/.exec(body);

  if (!found) {
    throw new Error(`no --scrim in ${selector}`);
  }

  return {
    colour: [Number(found[1]), Number(found[2]), Number(found[3])],
    alpha: Number(found[4]),
  };
}

const AA = 4.5;

/** Reported to two figures, because the number is the point. */
const measured: string[] = [];

function check(what: string, front: Rgb, back: Rgb, floor = AA): number {
  const ratio = contrast(front, back);

  measured.push(`${what}: ${ratio.toFixed(2)} to 1`);
  expect(ratio, what).toBeGreaterThanOrEqual(floor);

  return ratio;
}

describe('the themes', () => {
  const themes = [
    {
      name: 'dark',
      palette: dark,
      tint: rgb('#0a0c0f'),
      alpha: 0.78,
      sheer: 0.54,
      scrim: scrimOf("[data-theme='dark']"),
    },
    {
      name: 'light',
      palette: light,
      tint: rgb('#ffffff'),
      alpha: 0.8,
      sheer: 0.78,
      scrim: scrimOf("[data-theme='light']"),
    },
  ] as const;

  for (const { name, palette, tint, alpha, sheer, scrim } of themes) {
    describe(name, () => {
      it('has every token it needs', () => {
        for (const token of [
          'bg-canvas',
          'surface-card',
          'text-primary',
          'text-secondary',
          'text-tertiary',
          'text-accent',
          'text-error',
          'fill-accent',
          'text-on-accent',
        ]) {
          expect(palette[token], `--${token} in ${name}`).toBeDefined();
        }
      });

      it('meets AA on the canvas and on a card', () => {
        const canvas = rgb(palette['bg-canvas'] as string);
        const card = rgb(palette['surface-card'] as string);

        check(`${name} · primary on canvas`, rgb(palette['text-primary'] as string), canvas);
        check(`${name} · secondary on canvas`, rgb(palette['text-secondary'] as string), canvas);
        check(`${name} · tertiary on canvas`, rgb(palette['text-tertiary'] as string), canvas);
        check(`${name} · accent on canvas`, rgb(palette['text-accent'] as string), canvas);

        check(`${name} · primary on card`, rgb(palette['text-primary'] as string), card);
        check(`${name} · secondary on card`, rgb(palette['text-secondary'] as string), card);
        check(`${name} · tertiary on card`, rgb(palette['text-tertiary'] as string), card);
        check(`${name} · accent on card`, rgb(palette['text-accent'] as string), card);
        check(`${name} · error on card`, rgb(palette['text-error'] as string), card);
      });

      it('keeps a label on the accent legible', () => {
        check(
          `${name} · label on the accent fill`,
          rgb(palette['text-on-accent'] as string),
          rgb(palette['fill-accent'] as string),
        );
      });

      /*
       * The worst backdrop a bar can have is the brightest thing the theme can
       * put under it, which is its own primary text. In dark that lightens the
       * smoked tint towards the text sitting on it; in light the darkest
       * content does the same in the other direction. Anything else underneath
       * only helps.
       */
      it('meets AA on a bar over the worst backdrop', () => {
        const worst = rgb(palette['text-primary'] as string);
        const surface = over(tint, alpha, worst);

        check(`${name} · primary on bar glass`, rgb(palette['text-primary'] as string), surface);
        check(
          `${name} · secondary on bar glass`,
          rgb(palette['text-secondary'] as string),
          surface,
        );
        check(`${name} · accent on bar glass`, rgb(palette['text-accent'] as string), surface);
      });

      it('meets AA on a sheet over the scrim', () => {
        const worst = rgb(palette['text-primary'] as string);
        // The scrim has already dimmed the backdrop, which is what buys a sheet
        // its extra transparency. Both numbers come from `--scrim` itself.
        const dimmed = over(scrim.colour, scrim.alpha, worst);
        const surface = over(tint, sheer, dimmed);

        check(`${name} · primary on sheet glass`, rgb(palette['text-primary'] as string), surface);
        check(
          `${name} · secondary on sheet glass`,
          rgb(palette['text-secondary'] as string),
          surface,
        );
      });

      /*
       * Tertiary is banned on glass rather than merely discouraged, and the
       * stylesheet redefines the token on a blurred layer so a caption that
       * moves onto one is corrected. This is the measurement that ban rests on.
       */
      it('shows why tertiary is banned on glass', () => {
        const worst = rgb(palette['text-primary'] as string);
        const surface = over(tint, alpha, worst);
        const ratio = contrast(rgb(palette['text-tertiary'] as string), surface);

        measured.push(`${name} · tertiary on bar glass: ${ratio.toFixed(2)} to 1, banned`);
        expect(ratio).toBeLessThan(AA);
      });

      it('keeps the focus ring visible against every surface it lands on', () => {
        const ring = rgb(palette['focus-ring'] as string);

        for (const surface of ['bg-canvas', 'surface-card', 'surface-raised', 'surface-input']) {
          check(`${name} · focus ring on ${surface}`, ring, rgb(palette[surface] as string), 3);
        }
      });
    });
  }

  it('reports every ratio it measured', () => {
    for (const line of measured) {
      console.log(line);
    }

    expect(measured.length).toBeGreaterThan(0);
  });
});
