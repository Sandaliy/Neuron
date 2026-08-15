import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Read off disk for the same reason the contrast test does: vitest hands back
 * an empty string for a css import unless css handling is on for the project.
 */
const stylesheet = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'global.css'),
  'utf8',
);

/**
 * The motion specification, checked against the stylesheet that implements it.
 *
 * A browser test can only see the elements that happen to be on screen. This
 * reads every keyframe in the system, including the ones no current screen
 * uses, so a movement added in a later phase cannot animate a property that
 * costs layout without the check failing.
 */

/** Every `@keyframes name { ... }` block, by name. */
function keyframes(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;

  for (const match of stylesheet.matchAll(pattern)) {
    const open = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let index = open;

    while (depth > 0 && index < stylesheet.length) {
      if (stylesheet[index] === '{') {
        depth += 1;
      } else if (stylesheet[index] === '}') {
        depth -= 1;
      }

      index += 1;
    }

    found.set(match[1] as string, stylesheet.slice(open, index - 1));
  }

  return found;
}

/** The properties a keyframe sets, ignoring the percentage selectors. */
function properties(body: string): string[] {
  return [...body.matchAll(/([a-z-]+)\s*:/g)].map(([, name]) => name as string);
}

describe('motion', () => {
  const blocks = keyframes();

  it('has the movements the specification names', () => {
    for (const name of [
      'neu-in-forward',
      'neu-in-back',
      'neu-sheet-in',
      'neu-sheet-out',
      'neu-reveal',
      'neu-rise',
      'neu-toast-in',
      'neu-toast-out',
      'neu-shake',
      'neu-spin',
      'neu-shimmer',
    ]) {
      expect(blocks.has(name), `@keyframes ${name}`).toBe(true);
    }
  });

  /**
   * Transform and opacity only. Never height, width, top, left, or filter.
   *
   * Everything else is the browser doing layout or paint work on every frame,
   * and a filter is the whole layer rasterised again on every frame.
   */
  it('animates nothing but transform and opacity', () => {
    const allowed = new Set(['transform', 'opacity']);

    for (const [name, body] of blocks) {
      for (const property of properties(body)) {
        expect(allowed.has(property), `@keyframes ${name} sets ${property}`).toBe(true);
      }
    }
  });

  it('never transitions the blur radius', () => {
    const transitions = [...stylesheet.matchAll(/transition:\s*([^;]+);/g)].map(
      ([, value]) => value as string,
    );

    expect(transitions.length).toBeGreaterThan(0);

    for (const value of transitions) {
      expect(/filter/.test(value), `transition: ${value}`).toBe(false);
    }
  });

  /** Four durations, and every movement is described by one of them. */
  it('takes every duration from the four tokens', () => {
    const animations = [...stylesheet.matchAll(/animation:\s*([^;]+);/g)].map(
      ([, value]) => value as string,
    );

    expect(animations.length).toBeGreaterThan(0);

    for (const value of animations) {
      const named = /var\(--dur-[1-4]\)/.test(value);
      // The three loops are the exceptions the specification names: a spinner,
      // a skeleton sheen, and the one shake an error is allowed.
      const loop = /neu-spin|neu-shimmer|neu-shake/.test(value);

      expect(named || loop, `animation: ${value}`).toBe(true);
    }
  });

  /**
   * No entrance holds its last keyframe.
   *
   * `animation-fill-mode: both` leaves the final keyframe applied to the element
   * for as long as it lives, and a held transform, even `none`, keeps that
   * element on a composited layer of its own for ever. The screen stagger did
   * that to the container holding five hundred rows, and the library scroll fell
   * from 60 frames a second to 8.7 until the fill mode was changed to
   * `backwards`.
   */
  it('never leaves an entrance holding its last keyframe', () => {
    const held = [...stylesheet.matchAll(/animation:\s*(neu-[\w-]+)[^;]*\bboth\b/g)].map(
      ([, name]) => name as string,
    );

    expect(held).toEqual([]);
  });

  it('lets an exit hold where it ended', () => {
    // Something on its way out has to stay where it finished until whatever is
    // unmounting it gets around to it.
    for (const name of ['neu-sheet-out', 'neu-panel-out', 'neu-toast-out']) {
      const rule = new RegExp(String.raw`animation:\s*${name}[^;]*forwards`);

      expect(rule.test(stylesheet), name).toBe(true);
    }
  });

  it('collapses every duration when less movement is asked for', () => {
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesheet).toContain("[data-motion='reduce'] *");

    // Both blocks, and both of them saying the same thing.
    const collapsed = stylesheet.match(/animation-duration:\s*1ms\s*!important/g) ?? [];

    expect(collapsed.length).toBe(2);
  });
});
