import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The arithmetic behind a sheet that sits above the keyboard.
 *
 * jsdom does no layout, so what is provable here is the number the stylesheet
 * is handed. Where that number puts the sheet was checked in a browser at
 * 375 px: with a 336 px keyboard the sheet's bottom edge moves from 812 to 476,
 * which is the top of the keyboard.
 *
 * Every measurement is taken on the next frame rather than inside the event.
 * iOS fires these several times per frame while its toolbar slides, and each
 * one used to write three custom properties on the root element, which is a
 * style recalculation of the whole document. `frame()` is what the tests wait
 * on, and it is the only thing the batching changed about the behaviour.
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

/** Lets the batched measurement run. */
function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Reports a new viewport and waits for the document to carry it. */
async function report(change: { height?: number; offsetTop?: number }): Promise<void> {
  if (change.height !== undefined) {
    visual.height = change.height;
  }

  if (change.offsetTop !== undefined) {
    visual.offsetTop = change.offsetTop;
  }

  visual.dispatchEvent(new Event('resize'));

  await frame();
}

function variables() {
  const style = document.documentElement.style;

  return {
    inset: style.getPropertyValue('--keyboard-inset'),
    chrome: style.getPropertyValue('--chrome-inset'),
    height: style.getPropertyValue('--visual-viewport-height'),
  };
}

describe('tracking the visual viewport', () => {
  it('reports no keyboard when nothing is covering the page', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    expect(variables()).toEqual({ inset: '0px', chrome: '0px', height: '812px' });
  });

  it('measures what the keyboard covers when the layout viewport does not move', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    await report({ height: 476 });

    // 812 laid out, 476 visible: the keyboard has 336 of it.
    expect(variables()).toEqual({ inset: '336px', chrome: '0px', height: '476px' });
  });

  it('reports no keyboard when the layout viewport shrank with it', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    // What interactive-widget=resizes-content does: both shrink together, so
    // the bottom of the page already is the top of the keyboard.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 476 });

    await report({ height: 476 });

    expect(variables().inset).toBe('0px');
  });

  it('counts the page scrolled up under the keyboard as covered as well', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    await report({ height: 476, offsetTop: 40 });

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

    await report({ height: 476 });

    expect(reveal).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
  });

  /**
   * The whole field, not the control.
   *
   * A field is a label, an input, and the sentence underneath that says what is
   * expected or what is wrong. Revealing the input alone left that sentence
   * under the keys, which is how "At least 10 characters" ended up half
   * visible on a phone with the keyboard up.
   */
  it('reveals the whole field group rather than the control alone', async () => {
    const { trackViewport } = await import('./viewport');

    const group = document.createElement('div');
    const field = document.createElement('input');
    const revealGroup = vi.fn();

    group.dataset['field'] = '';
    group.scrollIntoView = revealGroup;
    field.scrollIntoView = vi.fn();
    group.append(field);
    document.body.append(group);
    field.focus();

    stop = trackViewport();

    await report({ height: 476 });

    expect(revealGroup).toHaveBeenCalled();
    expect(field.scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * A sheet is `position: fixed`, and on iOS a fixed element does not reliably
   * stay put while the page under it is scrolled with the keyboard up. So the
   * sheet's own body is the only thing allowed to move.
   */
  it('scrolls the body of a sheet rather than the page behind it', async () => {
    const { trackViewport } = await import('./viewport');

    const box = document.createElement('div');
    const group = document.createElement('div');
    const field = document.createElement('input');

    box.dataset['dialogBody'] = '';
    group.dataset['field'] = '';
    group.append(field);
    box.append(group);
    document.body.append(box);

    // jsdom lays nothing out, so the two boxes are stated rather than measured:
    // a 200 tall scroller with the field group 40 past the bottom of it.
    box.getBoundingClientRect = () => ({ top: 100, bottom: 300, height: 200 }) as DOMRect;
    group.getBoundingClientRect = () => ({ top: 280, bottom: 340, height: 60 }) as DOMRect;
    group.scrollIntoView = vi.fn();

    field.focus();
    stop = trackViewport();

    await report({ height: 476 });

    expect(box.scrollTop).toBe(40);
    expect(group.scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * A full page form is scrolled to its foot, not to the field.
   *
   * The action is the last thing in it and the fields are stacked above, so the
   * bottom of the form is the one view with everything that matters in it. The
   * page reserves the keyboard's height underneath, so that foot lands exactly
   * on top of the keys.
   */
  it('scrolls a full page form to its foot', async () => {
    const { trackViewport } = await import('./viewport');

    const form = document.createElement('div');
    const group = document.createElement('div');
    const field = document.createElement('input');
    const toFoot = vi.fn();

    form.dataset['form'] = '';
    group.dataset['field'] = '';
    group.append(field);
    form.append(group);
    document.body.append(form);

    form.scrollIntoView = toFoot;
    // Where the group lands once the form has been scrolled to its end: inside
    // the 476 pixels the keyboard leaves, so nothing more is needed.
    group.getBoundingClientRect = () => ({ top: 300, bottom: 380 }) as DOMRect;
    group.scrollIntoView = vi.fn();

    field.focus();
    stop = trackViewport();

    await report({ height: 476 });

    expect(toFoot).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
    expect(group.scrollIntoView).not.toHaveBeenCalled();
  });

  it('falls back to the field when the foot of the form leaves it off screen', async () => {
    const { trackViewport } = await import('./viewport');

    const form = document.createElement('div');
    const group = document.createElement('div');
    const field = document.createElement('input');

    form.dataset['form'] = '';
    group.dataset['field'] = '';
    group.append(field);
    form.append(group);
    document.body.append(form);

    form.scrollIntoView = vi.fn();
    // Scrolled off the top by a form too tall to show whole.
    group.getBoundingClientRect = () => ({ top: -40, bottom: 40 }) as DOMRect;
    group.scrollIntoView = vi.fn();

    field.focus();
    stop = trackViewport();

    await report({ height: 476 });

    expect(group.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
  });

  it('does not chase a viewport that shrank by a browser bar rather than a keyboard', async () => {
    const { trackViewport } = await import('./viewport');

    const field = document.createElement('input');
    const reveal = vi.fn();

    field.scrollIntoView = reveal;
    document.body.append(field);
    field.focus();

    stop = trackViewport();

    await report({ height: 762 });

    /*
     * Fifty pixels is a toolbar, not a keyboard. The sheet must not lift itself
     * by it, and the tab bar must, so the two variables answer differently.
     */
    expect(variables().inset).toBe('0px');
    expect(variables().chrome).toBe('50px');
    expect(reveal).not.toHaveBeenCalled();
  });

  /**
   * The jitter the tab bar used to have.
   *
   * iOS reports the visual viewport a fraction of a pixel at a time while a
   * finger is on the glass, and every one of those used to move the bar. A step
   * under three pixels is not a state change, and the bar stays where it is.
   */
  it('ignores a change too small to be the toolbar moving', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    await report({ height: 762 });

    expect(variables().chrome).toBe('50px');

    await report({ height: 760 });

    expect(variables().chrome).toBe('50px');

    await report({ height: 750 });

    expect(variables().chrome).toBe('62px');
  });

  it('always takes the toolbar having gone entirely', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    await report({ height: 810 });

    // Two pixels on its own is noise, but two pixels back to nothing covered is
    // the toolbar having finished retracting.
    expect(variables().chrome).toBe('0px');
  });

  it('says on the document whether the keyboard is up', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    await report({ height: 476 });

    expect(document.documentElement.dataset['keyboard']).toBe('open');

    await report({ height: 812 });

    expect(document.documentElement.dataset['keyboard']).toBe('closed');
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

    await report({ height: 476 });

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
