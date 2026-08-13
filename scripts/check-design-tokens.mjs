/**
 * The design system, enforced rather than described.
 *
 * CLAUDE.md says a hex value written in a component is a defect and that the
 * spacing scale has seven steps. A paragraph in a guide catches that on the day
 * somebody reads the guide. This catches it on the commit.
 *
 * Two rules, both narrow enough to have no false positives worth arguing with:
 *
 *   1. no colour literal anywhere under apps/web/src. Colours come from
 *      packages/config/tokens.css and reach a component as a utility class.
 *   2. no arbitrary spacing value in a Tailwind class. `p-[7px]` is off the
 *      scale by definition; the scale is what the utilities already offer.
 *      Anything built out of the safe area variables is allowed, because a
 *      phone's home indicator is not a design decision.
 *
 * Run from the lint script, next to check-core-isolation.mjs.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps', 'web', 'src');

/** `#abc`, `#aabbcc`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`. */
const COLOUR = /(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\()/;

/** A Tailwind spacing utility carrying a value in brackets. */
const ARBITRARY_SPACING =
  /\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-\[([^\]]+)\]/g;

/** Every file worth reading, recursively. */
function walk(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      found.push(full);
    }
  }

  return found;
}

const problems = [];

for (const file of walk(source)) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const lines = readFileSync(file, 'utf8').split('\n');

  // The stylesheet is where the tokens are wired to the utilities, so it is
  // the one file allowed to name a colour, and it names exactly one.
  const isStylesheet = relative.endsWith('src/styles/global.css');

  lines.forEach((line, index) => {
    const at = `${relative}:${index + 1}`;

    if (!isStylesheet && COLOUR.test(line)) {
      problems.push(
        `${at} colour literal. Use a token from packages/config/tokens.css.\n  ${line.trim()}`,
      );
    }

    for (const [whole, value] of line.matchAll(ARBITRARY_SPACING)) {
      if (
        !value.includes('--safe-') &&
        !value.includes('--bar-height') &&
        !value.includes('--keyboard-inset')
      ) {
        problems.push(
          `${at} ${whole} is off the spacing scale. Use 4, 8, 12, 16, 24, 32 or 48.\n  ${line.trim()}`,
        );
      }
    }
  });
}

if (problems.length > 0) {
  console.error('design tokens:\n');

  for (const problem of problems) {
    console.error(`  ${problem}\n`);
  }

  process.exit(1);
}

console.log('design tokens: ok');
