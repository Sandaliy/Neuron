/**
 * The design system, enforced rather than described.
 *
 * A paragraph in a guide catches a mistake on the day somebody reads the guide.
 * This catches it on the commit.
 *
 * Four rules, each narrow enough to have no false positives worth arguing with:
 *
 *   1. no colour literal outside `packages/config/tokens.css`. That file is the
 *      palette and the semantic layer over it; everywhere else names a token.
 *   2. no spacing value off the scale. Both halves of that: a bracketed value
 *      like `p-[7px]`, and a number the scale does not have, like `p-5`, which
 *      Tailwind silently generates nothing for.
 *   3. no raw duration in a component. There are four durations and they have
 *      names. `duration-300` is somebody deciding the motion system again.
 *   4. no raw token name in a component. `var(--n-900)` reaches past the
 *      semantic layer into the palette, which is exactly what makes a light
 *      theme a second stylesheet instead of a thirty line override.
 *
 * Run from the lint script, next to check-core-isolation.mjs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the rules apply. */
const ROOTS = [path.join(root, 'apps', 'web', 'src'), path.join(root, 'packages', 'config')];

/**
 * The one file that may write a colour, and the one that may write a duration
 * or name a raw token.
 *
 * `tokens.css` is the palette itself. `global.css` is the layer that wires the
 * palette to the utilities and defines the movements, so it is the one place
 * that says `var(--dur-3)` out loud.
 */
const TOKENS = 'packages/config/tokens.css';
const STYLESHEET = 'apps/web/src/styles/global.css';

/**
 * `#abc`, `#aabbcc`, `rgb(12 ...)`, `hsl(200 ...)`, `oklch(...)`, `color-mix(`.
 *
 * The colour functions have to be followed by a number, or this matches any
 * function that happens to be named `rgb`.
 */
const COLOUR = /(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\s*\(\s*[\d.]|\bcolor-mix\s*\()/;

/** Every step the scale has, plus the three sizes that are rules, not rhythm. */
const SPACING = new Set([0, 4, 8, 12, 16, 20, 24, 32, 40, 44, 48, 52, 56, 72, 96]);

/*
 * Padding, margin, gap and the offsets between things. Not widths and not
 * heights: a column capped at 64 characters or a phone frame 375 wide is a
 * measure, not a step in the rhythm, and the mockup writes both out.
 */
const SPACING_UTILITIES =
  'p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left';

/** A spacing utility carrying a bracketed value: off the scale by definition. */
const ARBITRARY_SPACING = new RegExp(String.raw`\b-?(?:${SPACING_UTILITIES})-\[([^\]]+)\]`, 'g');

/**
 * A spacing utility carrying a number.
 *
 * A fraction is a share of the parent rather than a step on the scale, so
 * `top-1/2` is centring and not a spacing value.
 */
const NUMERIC_SPACING = new RegExp(
  String.raw`(?<![\w-])-?(?:${SPACING_UTILITIES})-(\d+)(?![\d/])`,
  'g',
);

/**
 * What a bracketed value may be built from.
 *
 * A phone's home indicator and an on-screen keyboard are not design decisions,
 * and neither is how tall the navigation bar happens to be.
 */
const ALLOWED_IN_BRACKETS = [
  '--safe-',
  '--bar-height',
  '--bar-inset',
  '--keyboard-inset',
  '--chrome-inset',
  '--visual-viewport-height',
];

/** A duration written out rather than named. */
const RAW_DURATION = /\bduration-(?:\[[^\]]*\]|\d+)\b|\b\d+ms\b/;

/** The raw layer, which a component may not reach into. */
const RAW_TOKEN = /var\(\s*(--(?:n|p|a|sig|u|rad|t|lh|tr|w|dur|ease|g|raw)-[\w-]+)/;

/** Every file worth reading, recursively. */
function walk(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules') {
      continue;
    }

    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      /*
       * Tests are skipped. The two that measure this system, `contrast.test.ts`
       * and `motion.test.ts`, cannot be written without naming the values they
       * are checking, and a rule that fires on its own measurement is a rule
       * somebody switches off.
       */
      found.push(full);
    }
  }

  return found;
}

const problems = [];

for (const source of ROOTS) {
  for (const file of walk(source)) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const isTokens = relative === TOKENS;
    const isStylesheet = relative === STYLESHEET;
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      const at = `${relative}:${index + 1}`;
      const shown = line.trim();

      if (!isTokens && COLOUR.test(line)) {
        problems.push(`${at} colour literal. Name a token from ${TOKENS}.\n  ${shown}`);
      }

      for (const [whole, value] of line.matchAll(ARBITRARY_SPACING)) {
        if (!ALLOWED_IN_BRACKETS.some((allowed) => value.includes(allowed))) {
          problems.push(
            `${at} ${whole} is off the spacing scale.\n  Use 4, 8, 12, 16, 20, 24, 32, 40, 56, 72 or 96.\n  ${shown}`,
          );
        }
      }

      for (const [whole, value] of line.matchAll(NUMERIC_SPACING)) {
        if (!SPACING.has(Number(value))) {
          problems.push(
            `${at} ${whole} is off the spacing scale.\n  Use 4, 8, 12, 16, 20, 24, 32, 40, 56, 72 or 96.\n  ${shown}`,
          );
        }
      }

      // The stylesheet is where the movements are defined, so it is the one
      // place a duration is written out.
      if (!isTokens && !isStylesheet && RAW_DURATION.test(line)) {
        problems.push(
          `${at} raw duration. Use dur-control, dur-reveal, dur-screen or dur-sheet.\n  ${shown}`,
        );
      }

      const raw = RAW_TOKEN.exec(line);

      if (raw && !isTokens && !isStylesheet) {
        problems.push(
          `${at} ${raw[1]} is a raw token. Components name the semantic layer.\n  ${shown}`,
        );
      }
    });
  }
}

if (problems.length > 0) {
  console.error('design tokens:\n');

  for (const problem of problems) {
    console.error(`  ${problem}\n`);
  }

  process.exit(1);
}

console.log('design tokens: ok');
