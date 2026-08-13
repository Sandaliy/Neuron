/**
 * Where the on-screen keyboard is, as CSS variables.
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
 * fires continuously while the keyboard animates, and a re-render per frame of
 * that would be a stutter on the cheapest phone this has to work on.
 */
const KEYBOARD_INSET = '--keyboard-inset';
const VIEWPORT_HEIGHT = '--visual-viewport-height';

/** Below this, a shrunken viewport is a browser bar rather than a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

let keyboardWasOpen = false;

function apply(): void {
  const visual = window.visualViewport;

  if (!visual) {
    return;
  }

  const covered = Math.max(0, window.innerHeight - visual.height - visual.offsetTop);
  const root = document.documentElement;

  root.style.setProperty(KEYBOARD_INSET, `${Math.round(covered)}px`);
  root.style.setProperty(VIEWPORT_HEIGHT, `${Math.round(visual.height)}px`);

  const keyboardOpen = covered > KEYBOARD_THRESHOLD_PX;

  if (keyboardOpen !== keyboardWasOpen) {
    keyboardWasOpen = keyboardOpen;

    if (keyboardOpen) {
      revealFocused();
    }
  }
}

/**
 * Brings whatever is being typed into back onto the screen.
 *
 * The sheet scrolls inside itself, so this scrolls the field within the sheet
 * rather than moving the page. Centred rather than merely visible, because the
 * bottom of the visible area is where the keyboard is about to finish
 * animating to.
 */
function revealFocused(): void {
  const focused = document.activeElement;

  if (!(focused instanceof HTMLElement)) {
    return;
  }

  if (!focused.matches('input, textarea, select, [contenteditable]')) {
    return;
  }

  // Instant, not smoothed. A scroll that animates while the keyboard is also
  // animating reads as the field running away from the person.
  focused.scrollIntoView({ block: 'center', behavior: 'auto' });
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

  apply();

  visual.addEventListener('resize', apply);
  // The visual viewport scrolls independently of the page on iOS when the
  // keyboard is up, which moves the bottom edge without resizing anything.
  visual.addEventListener('scroll', apply);

  // Moving between two fields with the keyboard already open resizes nothing,
  // so the reveal has to hang off focus as well.
  document.addEventListener('focusin', onFocusIn);

  return () => {
    visual.removeEventListener('resize', apply);
    visual.removeEventListener('scroll', apply);
    document.removeEventListener('focusin', onFocusIn);

    document.documentElement.style.removeProperty(KEYBOARD_INSET);
    document.documentElement.style.removeProperty(VIEWPORT_HEIGHT);

    keyboardWasOpen = false;
    watching = false;
  };
}
