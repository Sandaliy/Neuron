import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { apply, resolve, storedTheme } from './theme';

/*
 * `join` rather than `new URL(path, import.meta.url)`.
 *
 * Vite rewrites that second form at build time into a url for the dev server
 * to serve, which is the right answer for an image in a component and the
 * wrong one for a file a test wants to read off disk.
 */
const html = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
  'utf8',
);

/**
 * The theme is decided twice: once by a script in `index.html` that runs before
 * the stylesheet, and once by this module while the app is running. The first
 * is what stops the page flashing the wrong colours; the second is what makes
 * the switch in settings work.
 *
 * Two copies of a rule drift apart. These tests run the copy in the html
 * against the same cases as the copy in TypeScript, so they cannot.
 */
/**
 * Runs the inline script from `index.html` against a fresh document.
 *
 * @param stored what local storage holds, if anything
 * @param prefersDark what the operating system asks for
 * @returns the theme the script put on the html element
 */
function runInlineScript(stored: string | undefined, prefersDark: boolean): string | undefined {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

  if (!script) {
    throw new Error('index.html has no inline theme script');
  }

  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();

  if (stored !== undefined) {
    localStorage.setItem('neuron.theme', stored);
  }

  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;

  new Function(script)();

  return document.documentElement.dataset['theme'];
}

describe('the theme', () => {
  const cases: readonly { stored: string | undefined; prefersDark: boolean; painted: string }[] = [
    { stored: undefined, prefersDark: true, painted: 'dark' },
    { stored: undefined, prefersDark: false, painted: 'light' },
    { stored: 'system', prefersDark: true, painted: 'dark' },
    { stored: 'system', prefersDark: false, painted: 'light' },
    { stored: 'dark', prefersDark: false, painted: 'dark' },
    { stored: 'light', prefersDark: true, painted: 'light' },
    // A value nobody wrote, or one left by an older build. Falls back rather
    // than putting an attribute the stylesheet has no rules for on the page.
    { stored: 'sepia', prefersDark: true, painted: 'dark' },
  ];

  for (const { stored, prefersDark, painted } of cases) {
    it(`paints ${painted} for ${stored ?? 'nothing'} stored with the system on ${prefersDark ? 'dark' : 'light'}`, () => {
      expect(runInlineScript(stored, prefersDark)).toBe(painted);

      // And the running app agrees with the script that drew the first frame.
      expect(resolve(storedTheme(), prefersDark)).toBe(painted);
    });
  }

  it('tells the browser which scheme to draw its own controls in', () => {
    // Without this the caret, the scrollbars and the form controls the browser
    // draws itself stay light on a dark page.
    apply('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    apply('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('runs before anything paints', () => {
    // The script has to be in the head and it has to be synchronous. Deferred,
    // or moved to the end of the body, and the first frame is drawn dark.
    const head = html.slice(0, html.indexOf('</head>'));

    expect(head).toContain('neuron.theme');
    expect(/<script(\s+[^>]*)?>/.exec(head)?.[1]).toBeUndefined();
  });
});
