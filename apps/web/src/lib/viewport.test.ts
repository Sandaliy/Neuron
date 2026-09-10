import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeVisualViewport extends EventTarget {
  height = 812;
  offsetTop = 0;
  scale = 1;
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
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

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

  it('leaves document focus scrolling to the browser', async () => {
    const { trackViewport } = await import('./viewport');

    const field = document.createElement('input');
    const reveal = vi.fn();

    field.scrollIntoView = reveal;
    document.body.append(field);
    field.focus();

    stop = trackViewport();

    await report({ height: 476 });

    expect(reveal).not.toHaveBeenCalled();
  });

  it('does not force-scroll a document field group', async () => {
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

    expect(revealGroup).not.toHaveBeenCalled();
    expect(field.scrollIntoView).not.toHaveBeenCalled();
  });

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

  it('does not move a page form to its foot', async () => {
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

    expect(toFoot).not.toHaveBeenCalled();
    expect(group.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not fight native scrolling for a tall page form', async () => {
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

    expect(group.scrollIntoView).not.toHaveBeenCalled();
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

    expect(variables().inset).toBe('0px');
    expect(variables().chrome).toBe('0px');
    expect(reveal).not.toHaveBeenCalled();
  });

  it('does not apply a second offset as browser chrome changes', async () => {
    const { trackViewport } = await import('./viewport');

    stop = trackViewport();

    await report({ height: 762 });

    expect(variables().chrome).toBe('0px');

    await report({ height: 760 });

    expect(variables().chrome).toBe('0px');

    await report({ height: 750 });

    expect(variables().chrome).toBe('0px');
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

  it('preserves native focus scrolling between fields', async () => {
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

    expect(reveal).not.toHaveBeenCalled();
  });

  it('does not hide navigation for stale dimensions after blur', async () => {
    const { trackViewport } = await import('./viewport');
    stop = trackViewport();
    await report({ height: 476, offsetTop: 180 });
    (document.activeElement as HTMLElement).blur();
    await frame();
    expect(document.documentElement.dataset['keyboard']).toBe('closed');
    expect(variables().inset).toBe('0px');
  });

  it('keeps keyboard detection stable when Safari pans above the keys', async () => {
    const { trackViewport } = await import('./viewport');
    stop = trackViewport();
    await report({ height: 476, offsetTop: 250 });
    expect(document.documentElement.dataset['keyboard']).toBe('open');
    expect(variables().inset).toBe('86px');
  });

  it('does not mistake pinch zoom or unfocused viewport changes for a keyboard', async () => {
    const { trackViewport } = await import('./viewport');
    stop = trackViewport();
    visual.scale = 2;
    await report({ height: 406 });
    expect(variables().inset).toBe('0px');
    visual.scale = 1;
    (document.activeElement as HTMLElement).blur();
    await report({ height: 476 });
    expect(variables().inset).toBe('0px');
  });

  it('starts without complaint on a browser that has no visual viewport', async () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });

    const { trackViewport } = await import('./viewport');

    expect(() => (stop = trackViewport())).not.toThrow();
    expect(variables().inset).toBe('');
  });
});
