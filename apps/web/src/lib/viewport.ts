/**
 * Where the on-screen keyboard is, and how much of the page the browser's own
 * furniture is covering, as CSS variables.
 *
 * A dialog on a phone is a sheet against the bottom edge, and `position: fixed`
 * measures that edge against the layout viewport. The keyboard does not change
 * the layout viewport on iOS, so the sheet stays exactly where it was and the
 * keyboard is drawn on top of it. The field being typed into is underneath.
 *
 * The visual viewport is the part actually on screen, and it does shrink. The
 * difference between the two is how much of the page the keyboard is covering,
 * which is what a sheet needs to sit above. On Android, with
 * `interactive-widget=resizes-content` in the viewport meta, the layout viewport
 * shrinks with the keyboard and that difference comes out as zero, which is the
 * right answer there.
 *
 * Written straight onto the document rather than held in React state. This
 * fires continuously while the keyboard animates and again while a scroll moves
 * Safari's toolbar, and a re-render per frame of that would be a stutter on the
 * cheapest phone this has to work on.
 */
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

/**
 * The same gap, when it is the browser's own furniture rather than a keyboard.
 *
 * Safari's toolbar sits in exactly the place a keyboard does, and the layout
 * viewport runs on underneath it, so anything meant to sit at the bottom of
 * what a person can see has to be lifted by this much.
 *
 * The two are separate on purpose. A sheet lifts for the keyboard and ignores
 * the toolbar; the tab bar lifts for the toolbar and gets out of the way
 * entirely for the keyboard. One number could not tell them apart.
 */
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

  const covered = Math.max(0, Math.round(window.innerHeight - visual.height - visual.offsetTop));
  const keyboardOpen = covered > KEYBOARD_THRESHOLD_PX;
  const root = document.documentElement;

  /*
   * The keyboard inset is zero unless it really is a keyboard. A sheet that
   * lifted itself by the height of Safari's toolbar would sit halfway up the
   * screen for no reason.
   */
  const keyboard = keyboardOpen ? covered : 0;
  const chrome = settle(keyboardOpen ? 0 : covered, published.chrome);
  const height = settle(Math.round(visual.height), published.height);
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

  if (keyboardOpen !== keyboardWasOpen) {
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

/**
 * Brings whatever is being typed into back onto the screen.
 *
 * The whole field is revealed, not the input alone: a field is a label, a
 * control, and the sentence underneath that says what is expected or what is
 * wrong. Centring the input left that sentence below the fold, which is how
 * "At least 10 characters" ended up half visible with the keyboard up.
 *
 * `nearest` scrolls by the smallest amount that brings the whole group into
 * view and does nothing when it is already there, so moving between two fields
 * does not shuffle the sheet about.
 */
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

  /*
   * A full page form is scrolled to its foot, not to the field.
   *
   * The action is the last thing in it and the fields are stacked directly
   * above, so the bottom of the form is the view that has everything in it that
   * matters: the field being typed into, and the button that finishes. The page
   * reserves the keyboard's height underneath, so the foot of the form lands
   * exactly on top of the keys.
   */
  const form = group.closest('[data-form]');

  if (form) {
    form.scrollIntoView({ block: 'end', behavior: 'auto' });

    if (onScreen(group)) {
      return;
    }
  }

  // Instant, not smoothed. A scroll that animates while the keyboard is also
  // animating reads as the field running away from the person.
  group.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

/** Whether all of something is inside the part of the page a person can see. */
function onScreen(element: Element): boolean {
  const visual = window.visualViewport;
  const top = visual ? visual.offsetTop : 0;
  const bottom = top + (visual ? visual.height : window.innerHeight);
  const box = element.getBoundingClientRect();

  return box.top >= top && box.bottom <= bottom;
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

  return () => {
    if (pending !== 0) {
      window.cancelAnimationFrame(pending);
      pending = 0;
    }

    visual.removeEventListener('resize', schedule);
    visual.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', onFocusIn);

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
