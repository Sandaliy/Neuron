import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The arithmetic behind a sheet that sits above the keyboard.
 *
 * jsdom does no layout, so what is provable here is the number the stylesheet
 * is handed. Where that number puts the sheet was checked in a browser at
 * 375 px: with a 336 px keyboard the sheet's bottom edge moves from 812 to 476,
 * which is the top of the keyboard.
 */
class FakeVisualViewport extends EventTarget {
  height = 812;
  offsetTop = 0;
}

let visual: FakeVisualViewport;
let stop: () => void = () => undefined;

beforeEach(() => {
  vi.resetModules();
  visual = new FakeVisualViewport();

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: visual,
    writable: true,
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812, writable: true });

  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '';
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

function variables() {
  const style = document.documentElement.style;

  return {
    inset: style.getPropertyValue('--keyboard-inset'),
    height: style.getPropertyValue('--visual-viewport-height'),
  };
}

describe('tracking the visual viewport', () => {
  it('reports no keyboard when nothing is covering the page', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    expect(variables()).toEqual({ inset: '0px', height: '812px' });
  });

  it('measures what the keyboard covers when the layout viewport does not move', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    visual.height = 476;
    visual.dispatchEvent(new Event('resize'));

    // 812 laid out, 476 visible: the keyboard has 336 of it.
    expect(variables()).toEqual({ inset: '336px', height: '476px' });
  });

  it('reports no keyboard when the layout viewport shrank with it', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    // What interactive-widget=resizes-content does: both shrink together, so
    // the bottom of the page already is the top of the keyboard.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 476 });
    visual.height = 476;
    visual.dispatchEvent(new Event('resize'));

    expect(variables().inset).toBe('0px');
  });

  it('counts the page scrolled up under the keyboard as covered as well', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    visual.height = 476;
    visual.offsetTop = 40;
    visual.dispatchEvent(new Event('resize'));

    expect(variables().inset).toBe('296px');
  });

  it('brings the field being typed into back onto the screen', async () => {
    const { trackViewport } = await import('./viewport');

    const field = document.createElement('input');
    const reveal = vi.fn();

    field.scrollIntoView = reveal;
    document.body.append(field);
    field.focus();

    stop = trackViewport();

    visual.height = 476;
    visual.dispatchEvent(new Event('resize'));

    expect(reveal).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  });

  it('does not chase a viewport that shrank by a browser bar rather than a keyboard', async () => {
    const { trackViewport } = await import('./viewport');

    const field = document.createElement('input');
    const reveal = vi.fn();

    field.scrollIntoView = reveal;
    document.body.append(field);
    field.focus();

    stop = trackViewport();

    visual.height = 762;
    visual.dispatchEvent(new Event('resize'));

    expect(variables().inset).toBe('50px');
    expect(reveal).not.toHaveBeenCalled();
  });

  it('follows focus moving between fields while the keyboard is already up', async () => {
    const { trackViewport } = await import('./viewport');

    const first = document.createElement('input');
    const second = document.createElement('input');
    const reveal = vi.fn();

    first.scrollIntoView = vi.fn();
    second.scrollIntoView = reveal;
    document.body.append(first, second);
    first.focus();

    stop = trackViewport();

    visual.height = 476;
    visual.dispatchEvent(new Event('resize'));

    second.focus();

    expect(reveal).toHaveBeenCalled();
  });

  it('starts without complaint on a browser that has no visual viewport', async () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });

    const { trackViewport } = await import('./viewport');

    expect(() => (stop = trackViewport())).not.toThrow();
    expect(variables().inset).toBe('');
  });
});
