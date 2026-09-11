/** Keyboard geometry for dialogs and toasts. Native fixed navigation handles
 * browser chrome. Measurements are batched and never scroll document forms. */
const KEYBOARD_INSET = '--keyboard-inset';
const VIEWPORT_HEIGHT = '--visual-viewport-height';

/**
 * Where the visible part of the page starts, measured from the layout viewport.
 *
 * Zero almost always, and not zero on iOS with a keyboard up: the visual
 * viewport scrolls there independently of the layout one, and anything
 * positioned against the layout viewport is then off the top of the screen by
 * this much.
 */
const VIEWPORT_TOP = '--visual-viewport-top';

/** Compatibility variable; native fixed chrome must not receive a second lift. */
const CHROME_INSET = '--chrome-inset';

/** Below this, a shrunken viewport is a browser bar rather than a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

/**
 * Movement smaller than this is not a state change.
 *
 * iOS reports the visual viewport a fraction of a pixel at a time while a
 * finger is on the glass, and again while a scroll rubber bands at either end.
 * Following every one of those moved the tab bar by a pixel per frame, which is
 * the jitter this exists to stop. Zero is always taken, because the toolbar
 * having gone entirely is a state change however small its last step was.
 */
const NOISE_PX = 3;

let keyboardWasOpen = false;

/*
 * What the document is currently carrying. A custom property written on the
 * root element invalidates style for the whole tree, so the ones that have not
 * changed are not written at all.
 */
let published = { keyboard: -1, chrome: -1, height: -1, top: -1 };

let pending = 0;

/** The new value, unless it is close enough to the old one to be noise. */
function settle(next: number, current: number): number {
  if (next === 0 || current < 0) {
    return next;
  }

  return Math.abs(next - current) < NOISE_PX ? current : next;
}

function measure(): void {
  pending = 0;

  const visual = window.visualViewport;

  if (!visual) {
    return;
  }

  const heightLoss = Math.max(0, Math.round(window.innerHeight - visual.height));
  const covered = Math.max(0, Math.round(heightLoss - visual.offsetTop));
  const focused = document.activeElement;
  const editing =
    focused instanceof HTMLElement &&
    focused.matches(
      'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]',
    );
  // Panning changes offsetTop, not keyboard size. Pinch zoom is not a keyboard.
  const keyboardOpen = editing && (visual.scale ?? 1) === 1 && heightLoss > KEYBOARD_THRESHOLD_PX;
  const root = document.documentElement;

  /*
   * The keyboard inset is zero unless it really is a keyboard. A sheet that
   * lifted itself by the height of Safari's toolbar would sit halfway up the
   * screen for no reason.
   */
  const keyboard = keyboardOpen ? covered : 0;
  const chrome = 0; // Native fixed navigation already follows Safari's chrome.
  const height = settle(Math.round(visual.height), published.height);
  // A panned visual viewport only matters to an open keyboard dialog. Leaving
  // this at zero while Safari's chrome moves avoids a document-wide style write
  // on every ordinary scroll event.
  const top = settle(Math.max(0, Math.round(visual.offsetTop)), published.top);

  if (keyboard !== published.keyboard) {
    published.keyboard = keyboard;
    root.style.setProperty(KEYBOARD_INSET, `${keyboard}px`);
  }

  if (chrome !== published.chrome) {
    published.chrome = chrome;
    root.style.setProperty(CHROME_INSET, `${chrome}px`);
  }

  if (height !== published.height) {
    published.height = height;
    root.style.setProperty(VIEWPORT_HEIGHT, `${height}px`);
  }

  if (top !== published.top) {
    published.top = top;
    root.style.setProperty(VIEWPORT_TOP, `${top}px`);
  }

  if (keyboardOpen !== keyboardWasOpen || root.dataset['keyboard'] === undefined) {
    keyboardWasOpen = keyboardOpen;

    /*
     * The tab bar goes away while the keyboard is up. It belongs to the bottom
     * of the screen and the keyboard has taken that, and a bar riding on top of
     * the keys is what a web page does rather than what an app does.
     */
    root.dataset['keyboard'] = keyboardOpen ? 'open' : 'closed';

    if (keyboardOpen) {
      revealFocused();
    }
  }
}

/**
 * Measures once, on the next frame.
 *
 * Every event that can move the viewport lands here rather than in `measure`.
 * iOS fires resize and scroll on the visual viewport more than once a frame
 * while its toolbar slides in and out, and each one of those used to write
 * three custom properties on the root element, which recalculates style for
 * every element in the document.
 */
function schedule(): void {
  if (typeof window.requestAnimationFrame !== 'function') {
    measure();

    return;
  }

  if (pending === 0) {
    pending = window.requestAnimationFrame(measure);
  }
}

/** Reveal only a dialog's inner field group; the browser owns page focus. */
function revealFocused(): void {
  const focused = document.activeElement;

  if (!(focused instanceof HTMLElement)) {
    return;
  }

  if (!focused.matches('input, textarea, select, [contenteditable]')) {
    return;
  }

  const group = focused.closest('[data-field]') ?? focused;
  const box = group.closest('[data-dialog-body]');

  if (box instanceof HTMLElement) {
    scrollWithin(box, group);

    return;
  }

  // Native focus scrolling owns document forms. Only a dialog's inner scroller
  // needs help; scrolling the document again fights Safari's keyboard panning.
}

/**
 * Scrolls one box, and nothing above it.
 *
 * `scrollIntoView` walks every scrollable ancestor, the document included. A
 * sheet is `position: fixed`, and on iOS a fixed element does not reliably stay
 * put while the page underneath it is being scrolled with the keyboard up: the
 * sheet drifts, and the button at the bottom of it ends up behind the keys.
 * The sheet's body is the only thing that has any business moving here, so this
 * moves that and leaves the page alone.
 *
 * @param box the scrolling part of the sheet
 * @param target the field group that has to be on screen
 */
function scrollWithin(box: HTMLElement, target: Element): void {
  const view = box.getBoundingClientRect();
  const item = target.getBoundingClientRect();

  const above = item.top - view.top;
  const below = item.bottom - view.bottom;

  // Already inside, or too tall to fit either way: align its top and let the
  // rest of it be scrolled to by hand.
  if (item.height > view.height || above < 0) {
    box.scrollTop += above;

    return;
  }

  if (below > 0) {
    box.scrollTop += below;
  }
}

let watching = false;

function onFocusIn(): void {
  schedule();
  if (keyboardWasOpen) {
    revealFocused();
  }
}

/**
 * Starts watching.
 *
 * A second call does nothing, and a browser with no visual viewport to ask is
 * left with the CSS defaults in `global.css`, which are the no keyboard answer.
 *
 * @returns a function that stops watching and puts the defaults back
 */
export function trackViewport(): () => void {
  const visual = window.visualViewport;

  if (!visual || watching) {
    return () => undefined;
  }

  watching = true;

  measure();

  visual.addEventListener('resize', schedule);
  // The visual viewport scrolls independently of the page on iOS when the
  // keyboard is up, which moves the bottom edge without resizing anything.
  visual.addEventListener('scroll', schedule);

  // Moving between two fields with the keyboard already open resizes nothing,
  // so the reveal has to hang off focus as well.
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', schedule);

  return () => {
    if (pending !== 0) {
      window.cancelAnimationFrame(pending);
      pending = 0;
    }

    visual.removeEventListener('resize', schedule);
    visual.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('visibilitychange', schedule);

    document.documentElement.style.removeProperty(KEYBOARD_INSET);
    document.documentElement.style.removeProperty(CHROME_INSET);
    document.documentElement.style.removeProperty(VIEWPORT_HEIGHT);
    document.documentElement.style.removeProperty(VIEWPORT_TOP);
    delete document.documentElement.dataset['keyboard'];

    published = { keyboard: -1, chrome: -1, height: -1, top: -1 };
    keyboardWasOpen = false;
    watching = false;
  };
}
